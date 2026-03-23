import { Card, CardContent } from "@/components/ui/card";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <div className="bg-green-700 p-6 text-center rounded-t-lg">
          <h1 className="text-xl font-bold text-white" data-testid="text-privacy-title">Privacy Policy</h1>
        </div>
        <CardContent className="p-6 prose prose-sm max-w-none text-sm text-muted-foreground space-y-4">
          <p><strong>Last Updated:</strong> March 2025</p>

          <h2 className="text-base font-semibold text-foreground">1. Information We Collect</h2>
          <p>
            We collect personal information you voluntarily provide when you use our services, request a quote, or communicate with us. This may include your name, email address, phone number, mailing address, and service preferences.
          </p>

          <h2 className="text-base font-semibold text-foreground">2. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide, maintain, and improve our pet waste removal services</li>
            <li>Communicate with you about scheduling, service updates, and billing</li>
            <li>Send you marketing and promotional messages (with your consent)</li>
            <li>Send transactional SMS messages such as appointment reminders, ETA notifications, and service completion alerts</li>
            <li>Process payments and manage your account</li>
            <li>Respond to your inquiries and provide customer support</li>
          </ul>

          <h2 className="text-base font-semibold text-foreground">3. SMS/Text Messaging</h2>
          <p>
            If you opt in to receive text messages, we may send you recurring automated marketing and informational messages at the phone number you provide. Message and data rates may apply. Message frequency varies. You can opt out at any time by replying STOP to any message. For help, reply HELP or contact us directly.
          </p>
          <p>
            We do not sell, rent, or share your phone number or SMS opt-in consent with third parties or affiliates for promotional purposes. Your information is used solely for the purposes described in this policy.
          </p>

          <h2 className="text-base font-semibold text-foreground">4. Information Sharing</h2>
          <p>
            We do not sell your personal information. We may share your information with trusted service providers who assist us in operating our business (e.g., payment processors, SMS providers), subject to confidentiality obligations. We may also disclose information if required by law.
          </p>

          <h2 className="text-base font-semibold text-foreground">5. Data Security</h2>
          <p>
            We implement reasonable security measures to protect your personal information from unauthorized access, alteration, or destruction. However, no method of transmission over the internet is 100% secure.
          </p>

          <h2 className="text-base font-semibold text-foreground">6. Your Rights</h2>
          <p>
            You may request access to, correction of, or deletion of your personal information by contacting us. You may also opt out of marketing communications at any time.
          </p>

          <h2 className="text-base font-semibold text-foreground">7. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on this page with an updated effective date.
          </p>

          <h2 className="text-base font-semibold text-foreground">8. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy, please contact us through your service provider's contact information.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
