export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

export const PALETTES: Palette[] = [
  { id: 'capture',  name: 'Capture',     colors: ['#eee3ce', '#5f7f32'] },
  { id: 'compiler', name: 'Compiler',    colors: ['#f3ead8', '#275f63'] },
  { id: 'verifier', name: 'Verifier',    colors: ['#f0dfbd', '#9a6b22'] },
  { id: 'policy',   name: 'Policy',      colors: ['#efe5d1', '#3b665f'] },
  { id: 'repair',   name: 'Repair',      colors: ['#f2e4ce', '#8b3e2f'] },
  { id: 'market',   name: 'Marketplace', colors: ['#f6eedf', '#746338'] },
];
