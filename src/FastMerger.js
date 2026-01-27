/**
 * FastMerger - Simple sentence-based merger for streaming transcription.
 * 
 * Ported from zdasr-main/src/zdasr/merger/fast_impl.py
 * 
 * This merger uses a simple strategy: trust the latest ASR window and
 * finalize complete sentences. It's faster and simpler than the complex
 * word-level alignment merger, but may have lower accuracy in some cases.
 * 
 * Uses winkNLP for proper NLP-based sentence boundary detection.
 */

import SentenceBoundaryDetector from './utils/SentenceBoundaryDetector.js';

/**
 * @typedef {Object} Word
 * @property {string} text - The word text
 * @property {number} start_time - Start time in seconds
 * @property {number} end_time - End time in seconds
 * @property {number} [confidence] - Confidence score (0-1)
 * @property {boolean} [finalized] - Whether the word is finalized
 */

/**
 * @typedef {Object} FastMergerOptions
 * @property {string} [sentenceBoundaryProvider='nlp'] - How to detect sentence boundaries ('nlp' or 'heuristic')
 * @property {string} [language='en'] - Language for sentence detection
 * @property {number} [minInitialContextTime=3.0] - Minimum time before first finalization
 * @property {boolean} [debug=false] - Enable debug logging
 */

export class FastMerger {
  /**
   * Create a FastMerger instance.
   * @param {FastMergerOptions} options 
   */
  constructor(options = {}) {
    this.config = {
      sentenceBoundaryProvider: options.sentenceBoundaryProvider || 'nlp',
      language: options.language || 'en',
      minInitialContextTime: options.minInitialContextTime ?? 3.0,
      debug: options.debug ?? false,
      ...options
    };

    /** @type {Word[]} - Finalized words in the merged transcript */
    this.mergedTranscript = [];
    
    /** @type {number} - Time cursor for the mature (finalized) portion */
    this.matureCursorTime = 0.0;
    
    /** @type {Word[]} - Last set of immature (unfinalized) words */
    this.lastImmatureWords = [];
    
    /** @type {number} - Sequence counter for stats */
    this._sequenceNum = 0;
    
    /** @type {Object} - Statistics */
    this.stats = {
      wordsFinalized: 0,
      wordsReplaced: 0,
      wordsAdded: 0,
      wordsKeptStable: 0
    };

    // Initialize sentence boundary detector with winkNLP
    this._sentenceDetector = new SentenceBoundaryDetector({
      useNLP: this.config.sentenceBoundaryProvider === 'nlp',
      debug: this.config.debug,
      nlpContextSentences: 4,  // Smaller context for faster processing
      maxRetainedSentences: 10
    });

    console.log('[FastMerger] Initialized with config:', this.config);
    console.log('[FastMerger] Sentence detector stats:', this._sentenceDetector.getStats());
  }

  /**
   * Detect sentence endings in the given words using NLP.
   * Returns array of word indices that end sentences.
   * @param {Word[]} words - Array of words with start_time, end_time, text
   * @returns {number[]} - Array of word indices that end sentences
   */
  _detectSentenceEndingIndices(words) {
    if (!words || words.length === 0) return [];

    // Transform words to format expected by SentenceBoundaryDetector
    // It expects {text, start, end} but we have {text, start_time, end_time}
    const transformedWords = words.map(w => ({
      text: w.text,
      start: w.start_time,
      end: w.end_time,
      confidence: w.confidence
    }));

    const sentenceEndings = this._sentenceDetector.detectSentenceEndings(transformedWords);
    
    // Extract word indices from the sentence ending results
    return sentenceEndings.map(ending => ending.wordIndex);
  }

  /**
   * Process incoming words from an ASR window.
   * @param {Word[]} words - Words from current transcription window
   * @returns {[Word[], number, Object]} - [mergedResult, stability, metadata]
   */
  process(words) {
    if (!words || words.length === 0) {
      return [
        this._getFullTranscript(),
        1.0,
        { cursor: this.matureCursorTime, action: 'no_words' }
      ];
    }

    // 1. Use NLP-based sentence boundary detection
    // This returns indices of words that END sentences
    const sentenceEndingIndices = this._detectSentenceEndingIndices(words);
    
    if (this.config.debug) {
      console.log(`[FastMerger] Detected ${sentenceEndingIndices.length} sentence endings at indices:`, sentenceEndingIndices);
    }

    // 2. Determine finalization
    // We finalize if we have at least one complete sentence (sentence ending detected)
    // AND there are more words after that sentence ending (indicating a new sentence started)
    // The last detected sentence ending before the final word can be finalized.
    
    let wordsToFinalizeCount = 0;
    let finalizedEndTime = this.matureCursorTime;
    
    // Find the last sentence ending that is NOT the very last word
    // (if the last word is a sentence ending, we wait for more words to confirm)
    let finalizableEndingIndex = -1;
    for (let i = sentenceEndingIndices.length - 1; i >= 0; i--) {
      const endingIdx = sentenceEndingIndices[i];
      // Check if there are words after this sentence ending
      if (endingIdx < words.length - 1) {
        finalizableEndingIndex = endingIdx;
        break;
      }
    }

    if (finalizableEndingIndex >= 0) {
      // We can finalize words up to and including the sentence ending
      wordsToFinalizeCount = finalizableEndingIndex + 1;
      
      if (wordsToFinalizeCount > 0) {
        const finalizedWords = words.slice(0, wordsToFinalizeCount);
        
        // Add finalized words to merged transcript
        for (const w of finalizedWords) {
          const wCopy = { ...w, finalized: true };
          this.mergedTranscript.push(wCopy);
          finalizedEndTime = wCopy.end_time;
          this.stats.wordsFinalized++;
        }
        
        // Update cursor
        if (finalizedEndTime > this.matureCursorTime) {
          this.matureCursorTime = finalizedEndTime;
          if (this.config.debug) {
            console.log(`[FastMerger] Advanced cursor to ${this.matureCursorTime.toFixed(2)}s (finalized ${wordsToFinalizeCount} words)`);
          }
        }
      }
    }

    // 3. Track remaining (unfinalized) words
    const remainingWords = words.slice(wordsToFinalizeCount);
    this.lastImmatureWords = remainingWords;
    
    // 4. Construct result
    // Result = Merged Transcript (finalized) + Remaining Words (unfinalized)
    const fullResult = this._getFullTranscript();
    
    // Stability is 1.0 if we advanced, 0.0 otherwise
    const stability = wordsToFinalizeCount > 0 ? 1.0 : 0.0;
    
    this._sequenceNum++;
    
    return [
      fullResult,
      stability,
      {
        cursor: this.matureCursorTime,
        action: 'fast_merge',
        finalizedCount: wordsToFinalizeCount,
        sentenceEndingsDetected: sentenceEndingIndices.length,
        sequenceNum: this._sequenceNum
      }
    ];
  }

  /**
   * Get the full transcript (finalized + immature words).
   * @returns {Word[]}
   */
  _getFullTranscript() {
    // Return finalized words + current immature words
    return [...this.mergedTranscript, ...this.lastImmatureWords];
  }

  /**
   * Flush pending words if they look like a complete sentence (timeout finalization).
   * Uses NLP to detect if the pending words form a complete sentence.
   * @returns {[Word[], number, Object]|null} - Result or null if nothing to flush
   */
  flush() {
    if (this.lastImmatureWords.length === 0) {
      return null;
    }

    // Use NLP to check if the pending words end with a sentence boundary
    const sentenceEndingIndices = this._detectSentenceEndingIndices(this.lastImmatureWords);
    
    // Check if the last word is a sentence ending (complete sentence)
    const lastWordIndex = this.lastImmatureWords.length - 1;
    const isCompleteSentence = sentenceEndingIndices.includes(lastWordIndex);

    if (isCompleteSentence) {
      let finalizedEndTime = this.matureCursorTime;

      for (const w of this.lastImmatureWords) {
        const wCopy = { ...w, finalized: true };
        this.mergedTranscript.push(wCopy);
        finalizedEndTime = wCopy.end_time;
        this.stats.wordsFinalized++;
      }

      const flushedCount = this.lastImmatureWords.length;
      this.lastImmatureWords = [];

      if (finalizedEndTime > this.matureCursorTime) {
        this.matureCursorTime = finalizedEndTime;
        if (this.config.debug) {
          console.log(`[FastMerger] FLUSH advanced cursor to ${this.matureCursorTime.toFixed(2)}s (${flushedCount} words)`);
        }
      }

      return [
        this._getFullTranscript(),
        1.0,
        {
          cursor: this.matureCursorTime,
          action: 'flush_finalize',
          flushedCount
        }
      ];
    }

    return null;
  }

  /**
   * Merge incoming transcription payload (compatibility with TranscriptionMerger API).
   * @param {Object} payload - Transcription payload with words array
   * @returns {Object} - Merged result with words, stats, matureCursorTime
   */
  merge(payload) {
    const words = payload.words || [];
    const [mergedWords, stability, metadata] = this.process(words);
    
    return {
      words: mergedWords,
      stats: { ...this.stats },
      matureCursorTime: this.matureCursorTime,
      stability,
      metadata
    };
  }

  /**
   * Reset the merger state.
   */
  reset() {
    this.mergedTranscript = [];
    this.matureCursorTime = 0.0;
    this.lastImmatureWords = [];
    this._sequenceNum = 0;
    this.stats = {
      wordsFinalized: 0,
      wordsReplaced: 0,
      wordsAdded: 0,
      wordsKeptStable: 0
    };
    // Reset the sentence detector state
    this._sentenceDetector.reset();
    console.log('[FastMerger] Reset');
  }

  /**
   * Update the sentence boundary detection configuration.
   * @param {Object} config - Configuration options for sentence detection
   */
  updateSentenceDetectorConfig(config) {
    this._sentenceDetector.updateConfig(config);
  }

  /**
   * Get current state for debugging.
   * @returns {Object}
   */
  getState() {
    return {
      mergedTranscriptLength: this.mergedTranscript.length,
      matureCursorTime: this.matureCursorTime,
      lastImmatureWordsLength: this.lastImmatureWords.length,
      stats: { ...this.stats },
      sequenceNum: this._sequenceNum,
      sentenceDetector: this._sentenceDetector.getStats()
    };
  }
}

export default FastMerger;
