import type { Messages } from '../types'

export const checks: Messages['checks'] = {
    atLine: (line, message) => `Line ${line}: ${message}`,
    headingTooDeep: 'Headings can only go down to ### (article)',
    duplicateId: (id) => `Article ID "${id}" is used more than once`,
    missingRef: (ref, id) => `The target of reference "${ref}" ({#${id}}) does not exist`,
    figureError: (error) => `Cannot draw diagram: ${error}`,
    mathError: (error) => `Cannot render formula: ${error}`,
    definition: (message) => `Defined terms: ${message}`,
    noTitle: 'The document has no title (# line)',
    emptyArticle: (label) => `${label} has no text`,
    preamble: 'Preamble',
    alreadyDefined: (term, line) => `"${term}" is already defined on line ${line}`,
    unusedDefinition: (term) => `"${term}" is defined but never used`,
    usedBeforeDefinition: (term, line) => `"${term}" is defined on line ${line} but used before its definition`,
    missingTarget: 'Referenced article not found',
    coverTwice: 'Only one cover (::: cover) is allowed',
    coverOutside: 'Put the cover (::: cover) between the title and the first chapter',
    coverUnclosed: 'The cover (::: cover) has no closing :::',
    tocTwice: 'Only one table of contents ([[_TOC_]]) is allowed',
    tocOutside: 'Put the table of contents ([[_TOC_]]) between the title and the first chapter',
}
