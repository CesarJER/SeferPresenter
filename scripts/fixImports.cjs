const fs = require('fs');

const fixImports = (filePath) => {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/from\s+['"]\.\.\/types/g, "from '../../types");
  content = content.replace(/from\s+['"]\.\.\/hooks/g, "from '../../hooks");
  content = content.replace(/from\s+['"]\.\.\/utils/g, "from '../../utils");
  
  if (filePath.includes('control') || filePath.includes('presenter')) {
    content = content.replace(/from\s+['"]\.\/AutoResizeText['"]/g, "from '../shared/AutoResizeText'");
    content = content.replace(/from\s+['"]\.\/SlideVisualizer['"]/g, "from '../shared/SlideVisualizer'");
  }
  
  if (filePath.endsWith('MenuPopup.tsx')) {
     content = content.replace(/import { getScriptureChapterVerses/g, "import { parseVideoSlideString } from '../../utils/videoUtils';\nimport { getScriptureChapterVerses");
  }
  
  fs.writeFileSync(filePath, content, 'utf8');
};

const dirs = [
  'src/components/control',
  'src/components/presenter',
  'src/components/shared'
];

dirs.forEach(d => {
  const files = fs.readdirSync(d);
  files.forEach(f => {
    if (f.endsWith('.tsx') || f.endsWith('.ts')) {
      fixImports(d + '/' + f);
    }
  });
});
