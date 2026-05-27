import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface EntryApprovedEmailProps {
  studioName: string
  routineTitle: string
  eventName: string
  categoryName: string
  viewUrl: string
  organizationName: string
  primaryColor?: string
}

export default function EntryApprovedEmail({
  studioName,
  routineTitle,
  eventName,
  categoryName,
  viewUrl,
  organizationName,
  primaryColor = '#FFC000',
}: EntryApprovedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Your entry &quot;{routineTitle}&quot; for {eventName} has been approved
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={{ ...heading, color: primaryColor }}>{organizationName}</Heading>
          <Hr style={hr} />
          <Heading style={heading}>Entry Approved</Heading>
          <Text style={paragraph}>
            Great news, <strong>{studioName}</strong>! Your entry has been approved:
          </Text>
          <Section style={card}>
            <Text style={cardLabel}>Routine</Text>
            <Text style={cardValue}>{routineTitle}</Text>
            <Text style={cardLabel}>Event</Text>
            <Text style={cardValue}>{eventName}</Text>
            <Text style={cardLabel}>Category</Text>
            <Text style={cardValue}>{categoryName}</Text>
          </Section>
          <Section style={buttonSection}>
            <Link href={viewUrl} style={{ ...button, backgroundColor: primaryColor }}>
              View Entry
            </Link>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            You received this because you are a member of {studioName} on {organizationName}.
          </Text>
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

const card = {
  backgroundColor: '#202020',
  padding: '24px',
  margin: '24px 0',
}

const cardLabel = {
  color: '#7D7D7D',
  fontSize: '12px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  margin: '0 0 4px',
}

const cardValue = {
  color: '#FFFFFF',
  fontSize: '16px',
  margin: '0 0 16px',
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
