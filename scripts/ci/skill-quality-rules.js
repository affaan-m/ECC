'use strict';

const REQUIRED_SECTIONS = [
  'When to Activate',
  'Core Concepts',
  'Examples',
  'Anti-Patterns',
  'Best Practices',
];

const SECRET_PATTERNS = [
  {
    regex: /(?:api[_-]?key|token|secret|passwd|password|access[_-]?key)\s*[:=]\s*["']([A-Za-z0-9_\-:/.!@#$%^&*()=+[\]{}|;'<>?,~]{8,})["']/gi,
  },
  {
    regex: /(?:api[_-]?key|token|secret|passwd|password|access[_-]?key)\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9_-]{11,})(?![A-Za-z0-9_(])/gi,
    accept: (match) => /\d/.test(match[1]) || match[1].length >= 24,
  },
  { regex: /sk_(?:live|test)_[A-Za-z0-9]{32,}/g },
  { regex: /ghp_[A-Za-z0-9]{20,}(?![a-z])/g },
  { regex: /xox[baprs]-[A-Za-z0-9-]{32,}/g },
];

const QUALITY_RULES = [
  {
    name: 'required-sections',
    description: 'Skill must contain all required sections',
    check(content, label) {
      const lines = content.split(/\r?\n/);

      return REQUIRED_SECTIONS.flatMap((section) => {
        const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const headingPattern = new RegExp(`^#{1,3}\\s*${escapedSection}\\s*$`, 'i');
        if (lines.some((line) => headingPattern.test(line.trim()))) return [];

        return [{
          label,
          line: 1,
          severity: 'error',
          message: `Missing required section: "${section}"`,
          hint: `Add a level 2 heading "## ${section}" with content below it`,
        }];
      });
    },
  },
  {
    name: 'section-depth',
    description: 'Each required section must have meaningful content (200+ chars)',
    check(content, label, isStrict) {
      if (!isStrict) return [];

      const extractSectionBody = (markdown, sectionTitle) => {
        const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const headingPattern = new RegExp(`^#{1,3}\\s*${escapedTitle}\\s*$`, 'i');
        const sectionHeadings = new Set(REQUIRED_SECTIONS.map((title) => title.toLowerCase()));
        const lines = markdown.split(/\r?\n/);
        let inTargetSection = false;
        let sectionStartLine = -1;
        let bodyLines = [];

        for (let index = 0; index < lines.length; index += 1) {
          const trimmed = lines[index].trim();
          if (!inTargetSection) {
            if (headingPattern.test(trimmed)) {
              inTargetSection = true;
              sectionStartLine = index;
            }
            continue;
          }

          const nextHeading = trimmed.match(/^#{1,3}\s*(.+?)\s*$/);
          if (nextHeading && sectionHeadings.has(nextHeading[1].trim().toLowerCase())) break;
          bodyLines = [...bodyLines, lines[index]];
        }

        return { body: bodyLines.join('\n').trim(), startLine: sectionStartLine };
      };

      return REQUIRED_SECTIONS.flatMap((section) => {
        const { body, startLine } = extractSectionBody(content, section);
        const normalized = body.replace(/[`*_~>#\-\s]/g, '').toLowerCase();
        const isEmpty = !normalized || ['todo', 'tbd', 'n/a', 'na', 'placeholder'].includes(normalized);
        if (!isEmpty && body.length >= 200) return [];

        return [{
          label,
          line: startLine + 2,
          severity: 'error',
          message: `Section "${section}" is ${isEmpty ? 'empty or placeholder-only' : 'too short'} (${body.length} chars)`,
          hint: `Expand "${section}" with meaningful content (aim for 200+ characters describing practical use and patterns)`,
        }];
      });
    },
  },
  {
    name: 'secret-patterns',
    description: 'Detect hardcoded API keys, tokens, and credentials',
    check(content, label) {
      return content.split(/\r?\n/).flatMap((line, index) => {
        const matchCount = SECRET_PATTERNS.reduce((count, { regex, accept }) => {
          const matches = [...line.matchAll(regex)];
          return count + matches.filter((match) => !accept || accept(match)).length;
        }, 0);
        if (matchCount === 0) return [];

        return [{
          label,
          line: index + 1,
          severity: 'error',
          message: `Detected ${matchCount} secret-like pattern(s) (API key, token, etc.)`,
          hint: `Replace credentials with a placeholder such as '<YOUR_API_KEY>'`,
        }];
      });
    },
  },
];

function checkQualityRules(content, label, isStrict) {
  return QUALITY_RULES.flatMap((rule) => rule.check(content, label, isStrict));
}

module.exports = { QUALITY_RULES, checkQualityRules };