---
description: Reafirme requisitos, avalie riscos e crie plano de implementação passo a passo. ESPERE confirmação do usuário ANTES de tocar em qualquer código.
---

# Comando Plan

Este comando invoca o agente **planner** para criar um plano abrangente de implementação antes de escrever qualquer código.

## O Que Este Comando Faz

1. **Reafirmar Requisitos** - Esclarecer o que precisa ser construído
2. **Identificar Riscos** - Levantar problemas e bloqueios potenciais
3. **Criar Plano em Etapas** - Quebrar implementação em fases
4. **Aguardar Confirmação** - DEVE receber aprovação do usuário antes de prosseguir

## Quando Usar

Use `/plan` quando:
- Estiver iniciando uma nova feature
- For fazer mudanças arquiteturais significativas
- Estiver trabalhando em refatoração complexa
- Múltiplos arquivos/componentes serão afetados
- Requisitos estiverem pouco claros ou ambíguos

## Como Funciona

O agente planner vai:

1. **Analisar o pedido** e reafirmar os requisitos de forma clara
2. **Quebrar em fases** com etapas específicas e acionáveis
3. **Identificar dependências** entre componentes
4. **Avaliar riscos** e possíveis bloqueios
5. **Estimar complexidade** (High/Medium/Low)
6. **Apresentar o plano** e AGUARDAR sua confirmação explícita

## Exemplo de Uso

```
User: /plan I need to add real-time notifications when markets resolve

Agent (planner):
# Implementation Plan: Real-Time Market Resolution Notifications

## Requirements Restatement
- Send notifications to users when markets they're watching resolve
- Support multiple notification channels (in-app, email, webhook)
- Ensure notifications are delivered reliably
- Include market outcome and user's position result

## Implementation Phases

### Phase 1: Database Schema
- Add notifications table with columns: id, user_id, market_id, type, status, created_at
- Add user_notification_preferences table for channel preferences
- Create indexes on user_id and market_id for performance

### Phase 2: Notification Service
- Create notification service in lib/notifications.ts
- Implement notification queue using BullMQ/Redis
- Add retry logic for failed deliveries
- Create notification templates

### Phase 3: Integration Points
- Hook into market resolution logic (when status changes to "resolved")
- Query all users with positions in market
- Enqueue notifications for each user

### Phase 4: Frontend Components
- Create NotificationBell component in header
- Add NotificationList modal
- Implement real-time updates via Supabase subscriptions
- Add notification preferences page

## Dependencies
- Redis (for queue)
- Email service (SendGrid/Resend)
- Supabase real-time subscriptions

## Risks
- HIGH: Email deliverability (SPF/DKIM required)
- MEDIUM: Performance with 1000+ users per market
- MEDIUM: Notification spam if markets resolve frequently
- LOW: Real-time subscription overhead

## Estimated Complexity: MEDIUM
- Backend: 4-6 hours
- Frontend: 3-4 hours
- Testing: 2-3 hours
- Total: 9-13 hours

**WAITING FOR CONFIRMATION**: Proceed with this plan? (yes/no/modify)
```

## Notas Importantes

**CRITICAL**: O agente planner **NÃO** vai escrever código até você confirmar explicitamente o plano com "yes", "proceed" ou resposta afirmativa similar.

Se quiser mudanças, responda com:
- "modificar: [suas alterações]"
- "abordagem diferente: [alternativa]"
- "pular fase 2 e fazer fase 3 primeiro"

Após planejar:
- Use `/tdd` para implementar com test-driven development
- Use `/build-fix` se ocorrerem erros de build
- Use `/code-review` para revisar a implementação concluída

## Agentes Relacionados

Este comando invoca o agente `planner` fornecido pelo ECC.

Para instalações manuais, o arquivo fonte fica em:
`agents/planner.md`
