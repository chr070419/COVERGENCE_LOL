import type { Metadata } from 'next';
export const metadata: Metadata = { title:'진인프라 융합본부 · LoL 내전', description:'공용 팀 편성과 내전 기록' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
