/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cairn/wavefield'],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
