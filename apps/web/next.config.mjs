/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O pacote do Raspberry Pi compila em .next-pi (NEXT_DIST_DIR) para NUNCA sobrescrever o .next do servidor de desenvolvimento.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
