// src/lib/aiDetector.js
import nlp from 'compromise'

// Score thresholds for answerability
const THRESHOLDS = {
  HIGH_CONFIDENCE: 70,    // Definitely needs answer
  MEDIUM_CONFIDENCE: 50,  // Probably needs answer
  LOW_CONFIDENCE: 30      // Maybe needs answer
}

// Question words (interrogatives)
const QUESTION_WORDS = ['what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'might', 'may']

// Action verbs that suggest a response is expected
const ACTION_VERBS = ['list', 'explain', 'describe', 'define', 'state', 'identify', 'name', 'provide', 'give', 'write', 'fill', 'complete', 'answer', 'solve', 'calculate', 'summarize', 'analyze', 'compare', 'contrast', 'discuss', 'evaluate', 'justify', 'prove', 'demonstrate', 'illustrate', 'outline', 'trace', 'review', 'assess', 'interpret', 'critique', 'suggest', 'recommend', 'propose']

// Keywords that indicate a blank or missing information
const BLANK_INDICATORS = ['_____', '___', '---', '...', 'blank', 'fill in', 'complete the', 'supply the', 'provide the']

/**
 * Detect if a sentence/statement requires an answer
 * Returns score from 0-100
 */
export const detectAnswerability = (text) => {
  if (!text || text.length < 5) return 0
  
  let score = 0
  const lowerText = text.toLowerCase()
  const doc = nlp(text)
  
  // 1. CHECK FOR QUESTION MARKS (Highest confidence)
  if (text.includes('?')) {
    score += 40
    
    // Check if it's a real question (has question words)
    const hasQuestionWord = QUESTION_WORDS.some(word => 
      lowerText.startsWith(word) || 
      lowerText.includes(` ${word} `) ||
      lowerText.includes(`${word} `)
    )
    if (hasQuestionWord) score += 30
  }
  
  // 2. CHECK FOR ACTION VERBS (High confidence)
  const hasActionVerb = ACTION_VERBS.some(verb => 
    lowerText.includes(`${verb} `) || 
    lowerText.startsWith(`${verb} `)
  )
  if (hasActionVerb) score += 35
  
  // 3. CHECK FOR BLANK INDICATORS (High confidence)
  const hasBlankIndicator = BLANK_INDICATORS.some(indicator => 
    lowerText.includes(indicator)
  )
  if (hasBlankIndicator) score += 45
  
  // 4. CHECK SENTENCE STRUCTURE using compromise
  const sentences = doc.sentences()
  if (sentences.length > 0) {
    const firstSentence = sentences.first()
    
    // Check if sentence is interrogative
    if (firstSentence.has('#Question')) {
      score += 25
    }
    
    // Check sentence length (longer sentences often need explanation)
    const wordCount = text.split(/\s+/).length
    if (wordCount > 15 && (hasActionVerb || text.includes('?'))) {
      score += 15
    }
  }
  
  // 5. CHECK FOR COMMAND/IMPERATIVE STRUCTURE
  if (doc.has('#Imperative')) {
    score += 20
  }
  
  // 6. CHECK FOR COLONS OR BULLET POINTS (often indicate lists to fill)
  if (text.includes(':') || text.includes('•') || text.includes('- ')) {
    score += 10
  }
  
  // 7. CHECK FOR NUMBERED ITEMS (1., 2., etc.)
  if (/^\d+\./.test(text)) {
    score += 15
  }
  
  // 8. CHECK FOR MISSING ARTICLES or incomplete feel
  const endsWithVerb = /(is|are|was|were|be|am|can|could|will|would|should|might)$/i.test(text.trim())
  if (endsWithVerb) {
    score += 20
  }
  
  // Cap at 100
  return Math.min(score, 100)
}

/**
 * Get confidence level label
 */
export const getConfidenceLevel = (score) => {
  if (score >= THRESHOLDS.HIGH_CONFIDENCE) return 'high'
  if (score >= THRESHOLDS.MEDIUM_CONFIDENCE) return 'medium'
  if (score >= THRESHOLDS.LOW_CONFIDENCE) return 'low'
  return 'none'
}

/**
 * Determine input type based on content
 */
export const determineInputType = (text, score) => {
  const lowerText = text.toLowerCase()
  
  // Check for lists or multiple items
  if (lowerText.includes('list') || lowerText.includes('name') || lowerText.includes('identify')) {
    return 'textarea' // Multi-line for lists
  }
  
  // Check for yes/no questions
  if (lowerText.includes('yes') || lowerText.includes('no') || 
      lowerText.includes('true') || lowerText.includes('false') ||
      (text.includes('?') && (lowerText.includes('is') || lowerText.includes('are')))) {
    return 'boolean' // Radio yes/no
  }
  
  // Check for single word/number answers
  if (lowerText.includes('what') || lowerText.includes('when') || 
      lowerText.includes('where') || lowerText.includes('who')) {
    return 'short-text' // Short answer
  }
  
  // Check for explanation answers
  if (lowerText.includes('explain') || lowerText.includes('describe') || 
      lowerText.includes('why') || lowerText.includes('how')) {
    return 'textarea' // Long answer
  }
  
  // Default based on score
  if (score > 80) return 'textarea'
  return 'short-text'
}

/**
 * Process entire document and identify all answerable content
 */
export const analyzeDocumentForAnswers = (html) => {
  // Create temporary div to parse HTML
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html
  
  // Find all text elements (paragraphs, list items, headings, divs)
  const textElements = tempDiv.querySelectorAll('p, li, h1, h2, h3, h4, div:not(div div), .text-block')
  
  const answerableItems = []
  
  textElements.forEach((el, index) => {
    const text = el.textContent.trim()
    if (!text || text.length < 5) return
    
    // Skip if already has input fields
    if (el.querySelector('input, textarea, .ai-input-field, .pen-wrapper')) return
    
    const score = detectAnswerability(text)
    const confidence = getConfidenceLevel(score)
    
    // Only process if confidence is medium or higher
    if (score >= THRESHOLDS.MEDIUM_CONFIDENCE) {
      const inputType = determineInputType(text, score)
      
      answerableItems.push({
        id: `ai_${Date.now()}_${index}_${Math.random()}`,
        element: el,
        originalText: text,
        score,
        confidence,
        inputType,
        position: index
      })
      
      console.log(`AI Detected: "${text.substring(0, 50)}..." - Score: ${score} (${confidence}) - Type: ${inputType}`)
    }
  })
  
  return answerableItems
}

/**
 * Inject answer fields into detected elements
 */
export const injectAnswerFields = (container, answerableItems, onFieldChange) => {
  let fieldId = 0
  const fields = []
  
  answerableItems.forEach(item => {
    const { element, originalText, inputType, id: itemId } = item
    const fieldId_full = `ai_${fieldId++}`
    
    fields.push({ 
      id: fieldId_full, 
      type: 'ai-detected', 
      original: originalText.substring(0, 100),
      inputType 
    })
    
    // Create wrapper
    const wrapper = document.createElement('div')
    wrapper.className = 'ai-answer-wrapper'
    wrapper.style.cssText = 'margin-bottom: 16px; border-left: 3px solid #1a6b3c; padding-left: 12px;'
    
    // Clone original content
    const contentClone = element.cloneNode(true)
    contentClone.style.margin = '0'
    contentClone.style.padding = '0'
    
    // Create confidence badge
    const confidenceBadge = document.createElement('div')
    confidenceBadge.style.cssText = 'font-size: 0.7rem; color: #1a6b3c; margin-top: 4px; margin-bottom: 6px;'
    confidenceBadge.innerHTML = `📝 AI-detected question (${item.score}% confidence)`
    
    // Create input based on type
    let inputHtml = ''
    if (inputType === 'boolean') {
      inputHtml = `
        <div style="display: flex; gap: 16px; margin-top: 8px;">
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="radio" name="ai_${fieldId_full}" value="yes" class="ai-radio-yes" data-id="${fieldId_full}"> ✅ Yes
          </label>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="radio" name="ai_${fieldId_full}" value="no" class="ai-radio-no" data-id="${fieldId_full}"> ❌ No
          </label>
        </div>
      `
    } else if (inputType === 'textarea') {
      inputHtml = `
        <textarea class="ai-textarea" data-id="${fieldId_full}" placeholder="Type your answer here..." style="width: 100%; padding: 10px; border: 2px solid #1a6b3c; border-radius: 8px; font-family: inherit; font-size: 0.9rem; resize: vertical; margin-top: 8px;" rows="3"></textarea>
      `
    } else {
      inputHtml = `
        <input type="text" class="ai-input" data-id="${fieldId_full}" placeholder="Type your answer here..." style="width: 100%; padding: 8px 12px; border: 2px solid #1a6b3c; border-radius: 6px; font-family: inherit; font-size: 0.9rem; margin-top: 8px;">
      `
    }
    
    const inputContainer = document.createElement('div')
    inputContainer.innerHTML = inputHtml
    inputContainer.style.marginTop = '8px'
    
    // Assemble wrapper
    wrapper.appendChild(contentClone)
    wrapper.appendChild(confidenceBadge)
    wrapper.appendChild(inputContainer)
    
    // Replace original element
    if (element.parentNode) {
      element.parentNode.replaceChild(wrapper, element)
    }
    
    // Attach event listeners
    setTimeout(() => {
      if (inputType === 'boolean') {
        const radios = wrapper.querySelectorAll('input[type="radio"]')
        radios.forEach(radio => {
          radio.addEventListener('change', () => {
            if (radio.checked) {
              onFieldChange(fieldId_full, radio.value === 'yes')
            }
          })
        })
      } else {
        const input = wrapper.querySelector('.ai-input, .ai-textarea')
        if (input) {
          input.addEventListener('input', () => {
            onFieldChange(fieldId_full, input.value)
          })
          input.addEventListener('blur', () => {
            onFieldChange(fieldId_full, input.value)
          })
        }
      }
    }, 0)
  })
  
  return fields
}