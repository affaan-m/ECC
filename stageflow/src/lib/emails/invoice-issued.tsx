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

interface InvoiceIssuedEmailProps {
  studioName: string
  invoiceNumber: string
  totalFormatted: string
  dueDate: string
  eventName: string
  payUrl: string
  organizationName: string
  primaryColor?: string
}

export default function InvoiceIssuedEmail({
  studioName,
  invoiceNumber,
  totalFormatted,
  dueDate,
  eventName,
  payUrl,
  organizationName,
  primaryColor = '#FFC000',
}: InvoiceIssuedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Invoice {invoiceNumber} for {totalFormatted} from {organizationName}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={{ ...heading, color: primaryColor }}>{organizationName}</Heading>
          <Hr style={hr} />
          <Heading style={heading}>Invoice Issued</Heading>
          <Text style={paragraph}>Hi {studioName},</Text>
          <Text style={paragraph}>
            A new invoice has been issued for your entries at <strong>{eventName}</strong>.
          </Text>
          <Section style={card}>
            <Text style={cardLabel}>Invoice</Text>
            <Text style={cardValue}>{invoiceNumber}</Text>
            <Text style={cardLabel}>Amount</Text>
            <Text style={{ ...cardValue, color: primaryColor, fontSize: '24px' }}>
              {totalFormatted}
            </Text>
            <Text style={cardLabel}>Due Date</Text>
            <Text style={cardValue}>{dueDate}</Text>
          </Section>
          <Section style={buttonSection}>
            <Link href={payUrl} style={{ ...button, backgroundColor: primaryColor }}>
              Pay Now
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
