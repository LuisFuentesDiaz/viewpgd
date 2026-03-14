/**
 * Redimensiona public/icons/icon-512x512.png a todos los tamaños del manifest
 * y genera el favicon dentro de la app (src/assets) para la pestaña del navegador.
 * Uso: node scripts/resize-icons.js
 */
const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384];
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
const assetsDir = path.join(__dirname, '..', 'src', 'assets');
const source = path.join(iconsDir, 'icon-512x512.png');

if (!fs.existsSync(source)) {
  console.error('No existe', source);
  process.exit(1);
}

async function run() {
  const sharp = require('sharp');
  const ico = require('sharp-ico');

  for (const size of sizes) {
    const dest = path.join(iconsDir, `icon-${size}x${size}.png`);
    await sharp(source)
      .resize(size, size)
      .png()
      .toFile(dest);
    console.log('Creado', path.basename(dest));
  }

  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  const appIconPath = path.join(assetsDir, 'icon.png');
  await sharp(source).resize(192, 192).png().toFile(appIconPath);
  console.log('Creado src/assets/icon.png (icono en la app)');
  const faviconOut = path.join(assetsDir, 'favicon.ico');
  await ico.sharpsToIco(
    [sharp(source)],
    faviconOut,
    { sizes: [48, 32, 16] }
  );
  console.log('Creado src/assets/favicon.ico');
  console.log('Listo.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
