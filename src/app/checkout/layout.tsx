export default function PrivateContentLayout({ children }: { children: React.ReactNode }) {
  return <div className="ym-hide-content ym-disable-keys">{children}</div>;
}
