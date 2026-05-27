import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface InviteEmailProps {
  inviteUrl: string
  inviterName: string
  organizationName: string
  role: string
  logoUrl?: string
  primaryColor?: string
}

export default function InviteEmail({
  inviteUrl,
  inviterName,
  organizationName,
  role,
  logoUrl,
  primaryColor = '#FFC000',
}: InviteEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {inviterName} invited you to join {organizationName} on StageFlow
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {logoUrl ? (
            <Img src={logoUrl} width="120" height="40" alt={organizationName} style={logo} />
          ) : (
            <Heading style={{ ...heading, color: primaryColor }}>StageFlow</Heading>
          )}
          <Hr style={hr} />
          <Heading style={heading}>You&apos;re invited</Heading>
          <Text style={paragraph}>
            <strong>{inviterName}</strong> has invited you to join{' '}
            <strong>{organizationName}</strong> as a <strong>{role}</strong>.
          </Text>
          <Section style={buttonSection}>
            <Link href={inviteUrl} style={{ ...button, backgroundColor: primaryColor }}>
              Accept Invitation
            </Link>
          </Section>
          <Text style={muted}>
            This invitation expires in 7 days. If you weren&apos;t expecting this, you can safely
            ignore it.
          </Text>
          <Hr style={hr} />
          <Text style={footer}>StageFlow — Competition management for performing arts</Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = {
  backgroundColor: '#000000',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
}

const container = {
  margin: '0 auto',
  padding: '48px 24px',
  maxWidth: '560px',
}

const logo = {
  margin: '0 auto 24px',
  display: 'block' as const,
}

const heading = {
  color: '#FFFFFF',
  fontSize: '24px',
  fontWeight: '600',
  margin: '24px 0 16px',
}

const paragraph = {
  color: '#F5F5F5',
  fontSize: '16px',
  lineHeight: '1.5',
  margin: '16px 0',
}

const muted = {
  color: '#7D7D7D',
  fontSize: '14px',
  lineHeight: '1.5',
  margin: '16px 0',
}

const hr = {
  borderColor: '#202020',
  margin: '24px 0',
}

const buttonSection = {
  textAlign: 'center' as const,
  margin: '32px 0',
}

const button = {
  color: '#000000',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  padding: '12px 32px',
  display: 'inline-block',
}

const footer = {
  color: '#555555',
  fontSize: '12px',
  textAlign: 'center' as const,
}
