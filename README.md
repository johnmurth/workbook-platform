# Workbook Platform

An interactive training workbook platform that enables lecturers to 
distribute fillable documents to participants and monitor responses in real time.

## Features
- 📄 DOCX to interactive fillable document conversion
- ✅ Inline checkboxes, radio buttons, and text inputs
- 💾 Auto-save answers to Firestore
- 👁️ Live session monitoring for lecturers
- 📥 PDF export with filled answers
- 🔒 Role-based access (lecturer / student)

## Tech Stack
- React + Vite
- Firebase (Auth, Firestore, Storage)
- Mammoth.js (DOCX → HTML)
- JSZip (raw DOCX XML parsing)

## Getting Started

### Prerequisites
- Node.js 18+
- Firebase project

### Installation
```bash
git clone https://github.com/yourusername/workbook-platform.git
cd workbook-platform
npm install
cp .env.example .env
# Fill in your Firebase credentials in .env
npm run dev
```

## Environment Variables
See `.env.example` for required variables.

## Deployment
Deployed on Vercel. Each push to `main` triggers an automatic redeploy.
