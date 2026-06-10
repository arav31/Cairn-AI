/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  transpilePackages: ['@cairn/wavefield'],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
