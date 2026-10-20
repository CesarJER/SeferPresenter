import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const sourceFiles = (directory = 'src') => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? sourceFiles(path.join(directory, entry.name))
    : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path.join(directory, entry.name)] : [])
  .filter(file => !file.replaceAll('\\', '/').startsWith('src/i18n/'))

const attributes = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label', 'description', 'emptyMessage'])
const displayCalls = /^(?:alert|confirm|setError|setLoadError|setSaveError|setStatusMessage|setFeedback)$/
export const parseSource = (file, source = fs.readFileSync(file, 'utf8')) => ts.createSourceFile(
  file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
)

export const uiLiterals = (ast) => {
  const results = []
  const visit = node => {
    let text
    let kind
    if (ts.isJsxText(node)) {
      text = node.text.replace(/\s+/g, ' ').trim()
      kind = 'text'
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const parent = node.parent
      if (ts.isJsxAttribute(parent) && attributes.has(parent.name.getText(ast))) kind = 'attribute'
      else if (ts.isPropertyAssignment(parent) && /^(label|title|description|message)$/.test(parent.name.getText(ast))) kind = 'expression'
      else {
        let ancestor = parent
        let nestedCall = false
        while (ancestor && !ts.isStatement(ancestor) && !ts.isJsxExpression(ancestor) && !ts.isJsxAttribute(ancestor)) {
          if (ts.isCallExpression(ancestor) && /^(?:t|translate)$/.test(ancestor.expression.getText(ast))) return
          if (ts.isCallExpression(ancestor)) nestedCall = true
          ancestor = ancestor.parent
        }
        const inJsx = !nestedCall && ancestor && ts.isJsxExpression(ancestor)
          && (!ts.isJsxAttribute(ancestor.parent) || attributes.has(ancestor.parent.name.getText(ast)))
        const inDisplayCall = ts.isCallExpression(parent) && displayCalls.test(parent.expression.getText(ast).split('.').pop())
        if (inJsx || inDisplayCall) kind = 'expression'
      }
      if (kind) text = ts.isTemplateExpression(node)
        ? node.head.text + node.templateSpans.map((span, i) => `{{value${i + 1}}}` + span.literal.text).join('')
        : node.text
    }
    if (kind && /[\p{L}]/u.test(text) && !/^(?:https?:|\/|#[\da-f]+$)/i.test(text)
      && !ts.isBinaryExpression(node.parent) && !ts.isCallExpression(node.parent?.parent)) {
      results.push({ node, text, kind, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 })
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return results
}
