export const numberToHebrewNumeral = (num: number): string => {
  const letters: Record<number, string> = {
    1: 'א', 2: 'ב', 3: 'ג', 4: 'ד', 5: 'ה', 6: 'ו', 7: 'ז', 8: 'ח', 9: 'ט', 10: 'י',
    20: 'כ', 30: 'ל', 40: 'מ', 50: 'נ', 60: 'ס', 70: 'ע', 80: 'פ', 90: 'צ', 100: 'ק',
    200: 'ר', 300: 'ש', 400: 'ת',
  };

  if (num <= 0) return '';
  if (num === 15) return 'ט״ו';
  if (num === 16) return 'ט״ז';

  let result: string;
  const parts: string[] = [];

  if (num >= 400) {
    const tavs = Math.floor(num / 400);
    parts.push(...Array<string>(tavs).fill(letters[400]));
    num %= 400;
  }

  const hundreds = Math.floor(num / 100) * 100;
  if (hundreds) {
    parts.push(letters[hundreds]);
    num %= 100;
  }

  const tens = Math.floor(num / 10) * 10;
  if (tens) {
    parts.push(letters[tens]);
    num %= 10;
  }

  if (num) parts.push(letters[num]);

  if (parts.length >= 2) {
    result = `${parts.slice(0, -1).join('')}״${parts.slice(-1)[0]}`;
  } else {
    result = `${parts[0]}׳`;
  }
  return result;
};

export const numberToGreekNumeral = (num: number): string => {
  if (num <= 0) return '';

  const units: Record<number, string> = {
    1: 'α', 2: 'β', 3: 'γ', 4: 'δ', 5: 'ε', 6: 'ϛ', 7: 'ζ', 8: 'η', 9: 'θ'
  };
  const tens: Record<number, string> = {
    10: 'ι', 20: 'κ', 30: 'λ', 40: 'μ', 50: 'ν', 60: 'ξ', 70: 'ο', 80: 'π', 90: 'ϟ'
  };
  const hundreds: Record<number, string> = {
    100: 'ρ', 200: 'σ', 300: 'τ', 400: 'υ', 500: 'φ', 600: 'χ', 700: 'ψ', 800: 'ω', 900: 'ϡ'
  };

  let result = '';

  if (num >= 1000) {
    const thousands = Math.floor(num / 1000);
    result += '͵' + numberToGreekNumeral(thousands).replace('′', '');
    num %= 1000;
  }

  const h = Math.floor(num / 100) * 100;
  if (h) {
    result += hundreds[h];
    num %= 100;
  }

  const t = Math.floor(num / 10) * 10;
  if (t) {
    result += tens[t];
    num %= 10;
  }

  if (num) {
    result += units[num];
  }

  if (result) {
    result += '′';
  }
  return result;
};
