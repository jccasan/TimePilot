import { Card, CardContent } from "@/components/ui/card";

export default function SmsTerms() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <div className="bg-green-700 p-6 text-center rounded-t-lg">
          <h1 className="text-xl font-bold text-white" data-testid="text-sms-terms-title">SMS Terms of Service</h1>
        </div>
        <CardContent className="p-6 prose prose-sm max-w-none text-sm text-muted-foreground space-y-4">
          <p><strong>Last Updated:</strong> March 2025</p>

          <h2 className="text-base font-semibold text-foreground">1. Overview</h2>
          <p>
            By opting in to receive text messages, you agree to these SMS Terms of Service. These terms apply to all SMS and MMS messages sent by your pet waste removal service provider through our platform.
          </p>

          <h2 className="text-base font-semibold text-foreground">2. Consent</h2>
          <p>
            By providing your phone number and checking the SMS consent checkbox, you expressly consent to receive recurring automated text messages from your service provider, including but not limited to:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Appointment reminders and schedule confirmations</li>
            <li>On-the-way / ETA notifications</li>
            <li>Service completion notifications with proof-of-service photos</li>
            <li>Invoice and payment reminders</li>
            <li>Promotional offers and service updates</li>
            <li>Quote responses and follow-up messages</li>
          </ul>
          <p>
            Consent to receive text messages is not a condition of purchasing any goods or services.
          </p>

          <h2 className="text-base font-semibold text-foreground">3. Message Frequency</h2>
          <p>
            Message frequency varies based on your service schedule and interactions. You may receive multiple messages per week depending on your service plan and communication preferences.
          </p>

          <h2 className="text-base font-semibold text-foreground">4. Costs</h2>
          <p>
            Message and data rates may apply depending on your mobile carrier and plan. You are responsible for any charges from your wireless provider.
          </p>

          <h2 className="text-base font-semibold text-foreground">5. Opt-Out</h2>
          <p>
            You can opt out of receiving text messages at any time by replying <strong>STOP</strong> to any message. After opting out, you will receive a single confirmation message and no further texts will be sent unless you re-subscribe.
          </p>

          <h2 className="text-base font-semibold text-foreground">6. Help</h2>
          <p>
            For assistance, reply <strong>HELP</strong> to any message or contact your service provider directly using the contact information provided at the time of sign-up.
          </p>

          <h2 className="text-base font-semibold text-foreground">7. Privacy</h2>
          <p>
            Your phone number and opt-in consent will not be sold, rented, or shared with third parties or affiliates for marketing or promotional purposes. Your information is used solely for the purposes described in our <a href="/privacy-policy" className="underline text-green-700 hover:text-green-800">Privacy Policy</a>.
          </p>

          <h2 className="text-base font-semibold text-foreground">8. Supported Carriers</h2>
          <p>
            Messages are sent via major carriers including AT&T, Verizon, T-Mobile, Sprint, and others. Carrier support may vary by region. T-Mobile is not liable for delayed or undelivered messages.
          </p>

          <h2 className="text-base font-semibold text-foreground">9. Changes</h2>
          <p>
            We reserve the right to modify these SMS Terms at any time. Changes will be posted on this page with an updated effective date. Continued receipt of messages after changes constitutes acceptance.
          </p>

          <h2 className="text-base font-semibold text-foreground">10. Contact</h2>
          <p>
            If you have questions about these SMS Terms, contact your service provider using the information provided during sign-up or reply HELP to any text message.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
