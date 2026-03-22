import { describe, expect, test } from 'vitest';
import { SentenceBoundaryDetector, type DetectorWord } from './SentenceBoundaryDetector';

describe('SentenceBoundaryDetector', () => {
    test('heuristic detection assigns stable wordIndex values by position', () => {
        const detector = new SentenceBoundaryDetector({ useNLP: false, debug: false });
        const repeated: DetectorWord = { text: 'repeat.', start: 0, end: 0.4 };
        const words: DetectorWord[] = [
            repeated,
            { text: 'middle', start: 0.5, end: 0.9 },
            repeated,
        ];

        const endings = detector.detectSentenceEndings(words);

        expect(endings).toHaveLength(2);
        expect(endings.map((word) => word.wordIndex)).toEqual([0, 2]);
        expect(endings.every((word) => word.sentenceMetadata?.detectionMethod === 'heuristic')).toBe(true);
    });
});
