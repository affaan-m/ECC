# Comando Verification

Rode verificação abrangente no estado atual do codebase.

## Instruções

Execute a verificação nesta ordem exata:

1. **Build Check**
   - Rode o comando de build deste projeto
   - Se falhar, reporte erros e PARE

2. **Type Check**
   - Rode o TypeScript/type checker
   - Reporte todos os erros com file:line

3. **Lint Check**
   - Rode o linter
   - Reporte warnings e errors

4. **Test Suite**
   - Rode todos os testes
   - Reporte contagem de pass/fail
   - Reporte percentual de cobertura

5. **Console.log Audit**
   - Procure por console.log em arquivos de código-fonte
   - Reporte localizações

6. **Git Status**
   - Mostre mudanças não commitadas
   - Mostre arquivos modificados desde o último commit

## Saída

Produza um relatório conciso de verificação:

```
VERIFICATION: [PASS/FAIL]

Build:    [OK/FAIL]
Types:    [OK/X errors]
Lint:     [OK/X issues]
Tests:    [X/Y passed, Z% coverage]
Secrets:  [OK/X found]
Logs:     [OK/X console.logs]

Ready for PR: [YES/NO]
```

Se houver problemas críticos, liste-os com sugestões de correção.

## Argumentos

$ARGUMENTS podem ser:
- `quick` - Apenas build + types
- `full` - Todas as checagens (padrão)
- `pre-commit` - Checagens relevantes para commits
- `pre-pr` - Checagens completas mais security scan
