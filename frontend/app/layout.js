import './globals.css';

export const metadata = {
  title: 'Sarayda Gece: Gizli Prenses',
  description: '8 kişilik gizli rol / sosyal çıkarım oyunu',
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body>
        {/* Masal diyarı sahne süslemeleri: bulutlar, saray, ağaçlar, prensesler —
            sabit, tıklanamaz, tüm sayfalarda aynı (bkz. globals.css .scene-decor).
            Salt görsel/dekoratif olduğu için ekran okuyuculardan gizlenir. */}
        <div className="scene-decor" aria-hidden="true">
          <span className="castle">🏰</span>
          <span className="cloud c1">☁️</span>
          <span className="cloud c2">☁️</span>
          <span className="cloud c3">☁️</span>
          <span className="cloud c4">☁️</span>
          <span className="tree t1">🌳</span>
          <span className="tree t2">🌲</span>
          <span className="tree t3">🌳</span>
          <span className="tree t4">🌲</span>
          <span className="princess p1">👸</span>
          <span className="princess p2">👸</span>
          <div className="ground" />
        </div>
        {children}
      </body>
    </html>
  );
}
