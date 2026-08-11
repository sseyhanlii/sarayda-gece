import './globals.css';

export const metadata = {
  title: 'Sarayda Gece: Gizli Prenses',
  description: '8 kişilik gizli rol / sosyal çıkarım oyunu',
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
