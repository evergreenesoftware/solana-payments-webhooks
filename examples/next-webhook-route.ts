// Next.js App Router: app/api/webhooks/solana/route.ts
import { SIGNATURE_HEADER, verifyWebhook } from 'solana-payments-webhooks';

const processed = new Set<string>(); // use a unique index in your database

export async function POST(req: Request) {
  const raw = await req.text();
  let event;
  try {
    event = await verifyWebhook(raw, req.headers.get(SIGNATURE_HEADER), process.env.WEBHOOK_SECRET!);
  } catch {
    return new Response('invalid signature', { status: 400 });
  }
  if (processed.has(event.id)) return new Response('duplicate'); // retries are expected; answer 2xx
  processed.add(event.id);
  // fulfil the order using event.data.memo / event.data.reference
  return new Response('ok');
}
