export const prerender = false;
import type { APIRoute } from 'astro';
import { getCronStatus, runCronNow, initCronWorker } from '../../../utils/cronWorker';

export const GET: APIRoute = async () => {
  initCronWorker();
  const status = getCronStatus();
  return new Response(JSON.stringify(status), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runCronNow(body.date);
    return new Response(JSON.stringify({ status: 'success', data: result, cron: getCronStatus() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ status: 'error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
