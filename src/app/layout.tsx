import type { Metadata } from "next";
import { getUser } from "@/lib/session";
import FeedbackWidget from "@/components/FeedbackWidget";
import "./globals.css";

export const metadata: Metadata = {
  title: "Feasible — Preliminary Site Design",
  description:
    "Can you build here — and what does the site work cost? Draw a lot, place the house, well, and septic, and check the setbacks.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getUser();
  return (
    <html lang="en">
      <body>
        {children}
        {user && (
          <FeedbackWidget
            app="feasible"
            submitterEmail={user.email}
            submitterName={user.fullName}
          />
        )}
      </body>
    </html>
  );
}
