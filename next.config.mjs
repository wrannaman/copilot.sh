/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["*.noco.io", "localhost"],
  serverExternalPackages: ['pdf-parse'], // Fix for pdf-parse import issues
};

export default nextConfig;
