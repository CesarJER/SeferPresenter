const fs = require('fs');
const path = 'src/components/control/MenuPopup.tsx';
let content = fs.readFileSync(path, 'utf8');

const regex = /\{\/\*\s*Fondo\s*\*\/\}\s*<div className="flex-1 space-y-1\.5 min-w-0">[\s\S]*?<Unlock size=\{15\} \/>\}\s*<\/button>\s*<\/div>\s*<\/div>/;

const match = content.match(regex);
if (match) {
  const replacement = `                {/* Fondo */}
                <BackgroundSelector
                  activeBackground={activeBackground}
                  currentPresentation={currentPresentation}
                  backgrounds={backgrounds}
                  onSelectBackgroundOverride={onSelectBackgroundOverride}
                  backgroundLock={backgroundLock}
                  onToggleBackgroundLock={onToggleBackgroundLock}
                />`;
  content = content.replace(regex, replacement);
  
  const importStatement = "import { BackgroundSelector } from './BackgroundSelector';\n";
  const importRegex = /(import \{ ScriptureRangeEditor \} from '\.\/ScriptureRangeEditor';\n)/;
  content = content.replace(importRegex, `$1${importStatement}`);
  
  fs.writeFileSync(path, content, 'utf8');
  console.log('Replaced BackgroundSelector');
} else {
  console.log('Could not find BackgroundSelector section');
}
