import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Relationship OS | فضای روابط شما',description:'مدیریت ارتباط‌ها، مناسبت‌ها و اقدام‌های کوچک برای رابطه‌های ماندگار',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fa" dir="rtl"><body>{children}</body></html>}
