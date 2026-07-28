/**
 * Cloud Functions for M-Pesa Daraja STK Push integration
 */
const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 10 }); 

// ============================================================
// SECRETS — pulled from functions/.env in development,
// and from Firebase Secret Manager when deployed
// ============================================================
const MPESA_CONSUMER_KEY = defineSecret("MPESA_CONSUMER_KEY");
const MPESA_CONSUMER_SECRET = defineSecret("MPESA_CONSUMER_SECRET");
const MPESA_SHORTCODE = defineSecret("MPESA_SHORTCODE");
const MPESA_PASSKEY = defineSecret("MPESA_PASSKEY");

// api base URL —  api.safaricom.co.ke for production
const MPESA_BASE_URL = "https://api.safaricom.co.ke";

// ============================================================
// HELPER: Get OAuth access token from Daraja
// ============================================================
const getAccessToken = async (consumerKey, consumerSecret) => {
  // Trim to remove any accidental whitespace/newlines from secret values
  const cleanKey = (consumerKey || "").trim();
  const cleanSecret = (consumerSecret || "").trim();

  const auth = Buffer.from(`${cleanKey}:${cleanSecret}`).toString("base64");

  const response = await fetch(
    `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
    }
  );

  const text = await response.text();

  if (!response.ok) {
    logger.error("Daraja OAuth failed", {
      status: response.status,
      body: text,
      keyLength: cleanKey.length,
      secretLength: cleanSecret.length,
    });
    throw new Error(`Failed to get access token: ${response.status} ${text}`);
  }

  const data = JSON.parse(text);
  return data.access_token;
};

// ============================================================
// HELPER: Generate timestamp in the format Daraja expects (YYYYMMDDHHmmss)
// ============================================================
const getTimestamp = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
};

// ============================================================
// CALLABLE FUNCTION: initiateMpesaPayment
// Called from PaymentPage.jsx with { phone, amount, workbookId }
// ============================================================
exports.initiateMpesaPayment = onCall(  
  {
    secrets: [MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY],
  },
  async (request) => {
    const { phone, amount, workbookId } = request.data;
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be logged in to make a payment.");
    }
    if (!phone || !amount || !workbookId) {
      throw new HttpsError("invalid-argument", "Missing phone, amount, or workbookId.");
    }

    // Normalize phone number to format 2547XXXXXXXX
    let normalizedPhone = phone.toString().trim();
    if (normalizedPhone.startsWith("0")) {
      normalizedPhone = "254" + normalizedPhone.substring(1);
    } else if (normalizedPhone.startsWith("+")) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    if (!/^254\d{9}$/.test(normalizedPhone)) {
      throw new HttpsError("invalid-argument", "Invalid phone number format.");
    }

    const consumerKey = MPESA_CONSUMER_KEY.value().trim();
    const consumerSecret = MPESA_CONSUMER_SECRET.value().trim();
    const shortcode = MPESA_SHORTCODE.value().trim();
    const passkey = MPESA_PASSKEY.value().trim();

    try {
      const accessToken = await getAccessToken(consumerKey, consumerSecret);

      const timestamp = getTimestamp();
      const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

      // Callback URL — this Cloud Function's mpesaCallback endpoint
      const callbackUrl = `https://us-central1-${process.env.GCLOUD_PROJECT || "fofo-4c356"}.cloudfunctions.net/mpesaCallback`;

      // Lightweight request log — no Password/secrets included
      logger.info("Initiating STK Push", {
        shortcode,
        amount: Math.round(amount),
        accountReference: `WB-${workbookId}`.substring(0, 12),
      });

      const stkResponse = await fetch(
        `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerBuyGoodsOnline",
            Amount: Math.round(amount),
            PartyA: normalizedPhone,
            PartyB: "3508571",
            PhoneNumber: normalizedPhone,
            CallBackURL: callbackUrl,
            AccountReference: `WB-${workbookId}`.substring(0, 12),
            TransactionDesc: "Workbook purchase",
          }),
        }
      );

      const stkData = await stkResponse.json();

      if (!stkResponse.ok || stkData.errorCode) {
        logger.error("STK Push failed", stkData);
        throw new HttpsError("internal", stkData.errorMessage || "STK Push request failed.");
      }

      // Store a pending transaction record so the callback can find it later
      const checkoutRequestId = stkData.CheckoutRequestID;
      await db.collection("WBmpesaTransactions").doc(checkoutRequestId).set({
        checkoutRequestId,
        merchantRequestId: stkData.MerchantRequestID,
        uid,
        workbookId,
        phone: normalizedPhone,
        amount: Math.round(amount),
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const purchaseId = `${uid}_${workbookId}`;

      return {
        success: true,
        checkoutRequestId,
        purchaseId: purchaseId,
        message: "STK Push sent. Check your phone to complete payment.",
      };
    } catch (err) {
      logger.error("initiateMpesaPayment error", err);
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message || "Payment initiation failed.");
    }
  }
);

// ============================================================
// HTTP FUNCTION: mpesaCallback
// Safaricom calls this URL when the STK Push completes (success or failure)
// ============================================================
exports.mpesaCallback = onRequest(async (req, res) => {
  try {
    logger.info("M-Pesa callback received", JSON.stringify(req.body));

    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
      logger.warn("No stkCallback in request body");
      res.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }

    const checkoutRequestId = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode;
    const resultDesc = callback.ResultDesc;

    const txnRef = db.collection("WBmpesaTransactions").doc(checkoutRequestId);
    const txnSnap = await txnRef.get();

    if (!txnSnap.exists) {
      logger.warn(`No transaction found for CheckoutRequestID ${checkoutRequestId}`);
      res.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }

    const txn = txnSnap.data();

    if (resultCode === 0) {
      // ── PAYMENT SUCCESSFUL ──
      const callbackMetadata = callback.CallbackMetadata?.Item || [];
      const getMetaValue = (name) =>
        callbackMetadata.find((item) => item.Name === name)?.Value;

      const mpesaReceiptNumber = getMetaValue("MpesaReceiptNumber");
      const transactionDate = getMetaValue("TransactionDate");
      const amountPaid = getMetaValue("Amount");

      await txnRef.update({
        status: "completed",
        mpesaReceiptNumber,
        transactionDate,
        amountPaid,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // ── Run the same logic as handlePurchase: create session + purchase record ──
      const workbookRef = db.collection("workbooks").doc(txn.workbookId);
      const workbookSnap = await workbookRef.get();

      if (!workbookSnap.exists) {
        logger.error(`Workbook ${txn.workbookId} not found`);
        res.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
        return;
      }

      const workbook = { id: workbookSnap.id, ...workbookSnap.data() };
      const purchaseId = `${txn.uid}_${txn.workbookId}`;
      const purchaseRef = db.collection("WBpurchases").doc(purchaseId);
      const existingPurchase = await purchaseRef.get();

      // FIX: the frontend's handlePurchase() pre-creates this exact
      // WBpurchases doc with status:'pending' *before* the STK push even
      // finishes (see the "KEY FIX" comment in PaymentPage.jsx). That
      // means by the time this callback runs, existingPurchase.exists is
      // ALWAYS true for a normal successful flow — it does not mean a
      // session/completed purchase already exists. The old check here
      // (`if (existingPurchase.exists)`) was matching that pending doc,
      // short-circuiting before a session was ever created, and linking
      // an undefined sessionId to the transaction. We only want to skip
      // session creation if a purchase is already marked 'completed'
      // (e.g. a duplicate/retry callback for a workbook the user already
      // owns).
      if (existingPurchase.exists && existingPurchase.data().status === "completed") {
        // Already has a completed session — link this transaction to it and finish.
        await txnRef.update({ sessionId: existingPurchase.data().sessionId });
        res.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
        return;
      }

      // Fetch student profile for name
      const userSnap = await db.collection("WBusers").doc(txn.uid).get();
      const studentName = userSnap.exists ? userSnap.data().name : "Student";

      const sessionRef = await db.collection("WBsessions").add({
        workbookId: workbook.id,
        workbookTitle: workbook.title,
        workbookUrl: workbook.fileUrl,
        studentUid: txn.uid,
        studentName,
        lecturerUid: workbook.lecturerUid,
        lecturerName: workbook.lecturerName,
        downloadLimit: workbook.downloadLimit || 3,
        downloadCount: 0,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastActive: admin.firestore.FieldValue.serverTimestamp(),
        answers: {},
        moduleProgress: {},
        currentModule: 0,
        totalModules: workbook.totalModules || 1
      });

      await purchaseRef.set({
        workbookId: workbook.id,
        workbookTitle: workbook.title,
        price: workbook.price,
        studentUid: txn.uid,
        studentName,
        lecturerUid: workbook.lecturerUid,
        lecturerName: workbook.lecturerName,
        sessionId: sessionRef.id,
        checkoutRequestId,
        mpesaReceiptNumber,
        purchaseDate: admin.firestore.FieldValue.serverTimestamp(),
        status: "completed",
      });

      await workbookRef.set(
        { totalPurchases: (workbook.totalPurchases || 0) + 1 },
        { merge: true }
      );

      await txnRef.update({ sessionId: sessionRef.id });

      logger.info(`Session ${sessionRef.id} created for user ${txn.uid}`);
    } else {
      // ── PAYMENT FAILED OR CANCELLED ──
      await txnRef.update({
        status: "failed",
        resultCode,
        resultDesc,
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // The frontend's onSnapshot listener watches WBpurchases, not
      // WBmpesaTransactions — without this, a failed/wrong-PIN payment
      // never reaches the frontend and the page waits forever.
      const purchaseId = `${txn.uid}_${txn.workbookId}`;
      const purchaseRef = db.collection("WBpurchases").doc(purchaseId);
      const existingPurchase = await purchaseRef.get();

      // Don't clobber a purchase that's already completed (e.g. a retry
      // after an earlier successful payment for the same workbook).
      if (!existingPurchase.exists || existingPurchase.data().status !== "completed") {
        await purchaseRef.set(
          {
            workbookId: txn.workbookId,
            studentUid: txn.uid,
            status: "failed",
            resultCode,
            resultDesc,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      logger.info(`Payment failed for ${checkoutRequestId}: ${resultDesc}`);
    }

    res.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    logger.error("mpesaCallback error", err);
    // Always respond 200 to Safaricom even on internal error,
    // otherwise Safaricom will retry the callback repeatedly
    res.status(200).send({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});