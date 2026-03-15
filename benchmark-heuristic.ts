import { SentenceBoundaryDetector } from './src/lib/transcription/SentenceBoundaryDetector';

const detector = new SentenceBoundaryDetector({ useNLP: false });

const words = [];
for (let i = 0; i < 10000; i++) {
    words.push({
        text: i % 10 === 0 ? 'word.' : 'word',
        start: i * 0.5,
        end: i * 0.5 + 0.4
    });
}

// Warm up
for (let i = 0; i < 10; i++) {
    detector['detectSentenceEndingsHeuristic'](words);
}

const start = performance.now();
for (let i = 0; i < 100; i++) {
    detector['detectSentenceEndingsHeuristic'](words);
}
const end = performance.now();

console.log(`Baseline heuristic processing took: ${end - start} ms`);
