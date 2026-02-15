import fs from 'fs';
const trace = JSON.parse(fs.readFileSync('Trace-20260215T021055.json', 'utf8'));
const events = trace.traceEvents || trace;
const threadNames = {};
events.forEach(e => {
  if (e.name === 'thread_name' && e.ph === 'M') {
    threadNames[`${e.pid}:${e.tid}`] = e.args.name;
  }
});
console.log(JSON.stringify(threadNames, null, 2));
