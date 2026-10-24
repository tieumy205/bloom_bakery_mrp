import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors.ts';
export function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
export async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3_000_000) throw new HttpError(413, 'Dữ liệu quá lớn.');
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(422, 'Nội dung JSON không hợp lệ.');
  }
}
