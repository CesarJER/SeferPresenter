const fs = require('fs');

const rawData = fs.readFileSync('presentations.json', 'utf-8');
const presentations = JSON.parse(rawData);

let modified = false;

for (const p of presentations) {
  for (const slide of p.slides) {
    if (slide.lines && slide.lines.length > 0) {
      for (let i = 0; i < slide.lines.length; i++) {
        const line = slide.lines[i];
        if (line.trim().startsWith('[VIDEO')) {
          // [VIDEO - "ruta_video" - volumen - velocidad - bucle - inicio - fin]
          const inner = line.trim().substring(line.indexOf('[') + 6, line.length - 1).trim();
          const parts = inner.substring(1).split(' - ').map(p => p.trim());
          
          let rawSrc = parts[0];
          const volRaw = parts[1] || '1';
          const speedRaw = parts[2] || '1';
          const loopRaw = parts[3] || '1';
          const startRaw = parts[4] || '';
          const endRaw = parts[5] || '';
          
          // Format as MEDIA:
          // [MEDIA - ruta - fit - nav - showBg - loop - vol - speed - start - end]
          let newParts = ['[MEDIA'];
          newParts.push(rawSrc); // ruta
          newParts.push('cover'); // fit
          newParts.push('1'); // nav
          newParts.push('0'); // showBg
          newParts.push(parseFloat(loopRaw) !== 0 ? '1' : '0'); // loop
          newParts.push(volRaw); // vol
          newParts.push(speedRaw); // speed
          
          if (startRaw) {
            newParts.push(startRaw);
            if (endRaw) newParts.push(endRaw);
          } else if (endRaw) {
            newParts.push('');
            newParts.push(endRaw);
          }

          // trimming defaults
          while (newParts.length > 2) {
            const last = newParts[newParts.length - 1];
            if (
              (newParts.length === 3 && last === 'cover') ||
              (newParts.length === 4 && last === '1') || // nav
              (newParts.length === 5 && last === '0') || // showBg
              (newParts.length === 6 && last === '1') || // loop
              (newParts.length === 7 && last === '1') || // vol
              (newParts.length === 8 && last === '1')    // speed
            ) {
              newParts.pop();
            } else {
              break;
            }
          }

          const newText = newParts.join(' - ') + ']';
          slide.lines[i] = newText;
          modified = true;
          console.log(`Migrated: ${line} -> ${newText}`);
        }
      }
    }
  }
}

if (modified) {
  fs.writeFileSync('presentations.json', JSON.stringify(presentations, null, 2), 'utf-8');
  console.log('Successfully updated presentations.json');
} else {
  console.log('No [VIDEO] tags found to migrate.');
}
