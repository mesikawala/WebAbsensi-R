import { defineMiddleware } from 'astro:middleware';
import { initCronWorker } from './utils/cronWorker';

// Inisialisasi background cron worker 23:00 WIB
initCronWorker();

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // Izinkan akses bebas ke API, aset statis, favicon, dan halaman login
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_astro') ||
    pathname.startsWith('/assets') ||
    pathname.startsWith('/favicon') ||
    pathname === '/login'
  ) {
    return next();
  }

  // Cek sesi autentikasi dari cookie
  const authSession = context.cookies.get('auth_session')?.value;
  if (!authSession) {
    return context.redirect('/login');
  }

  return next();
});
