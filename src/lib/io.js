export async function readStdinJson(stream = process.stdin) {
  let data = '';
  for await (const chunk of stream) data += chunk;
  return JSON.parse(data);
}

export function emit(obj, stream = process.stdout) {
  stream.write(JSON.stringify(obj));
}

// Hook entry wrapper: any failure is swallowed and the process exits 0 —
// a broken style check must never block the user's prompt or tool call.
// No process.exit(): exiting while stdout is a pipe can truncate the JSON
// mid-write; letting the event loop drain flushes it and still exits 0.
export function runHook(main) {
  return main().catch(() => {});
}
