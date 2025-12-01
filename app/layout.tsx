// by 拜甘教成员-大长老
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "血染钟楼辅助工具",
  description: "血染钟楼桌游辅助工具 - 帮助您更好地进行游戏",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
