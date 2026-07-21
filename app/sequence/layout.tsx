import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Experimental Sequence",
  description: "Development preview of Ruined's long-form frame sequence.",
  robots: { index: false, follow: false },
};

export default function SequenceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
