import { useState, useEffect } from "react";
import { Star, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface TokenData {
  valid: boolean;
  used: boolean;
  companyName: string;
  companyLogoUrl: string | null;
  contactFirstName: string;
  googleReviewUrl: string | null;
}

type Step = "loading" | "rating" | "positive" | "negative" | "submitted" | "error";

export default function ReviewRouter() {
  const token = typeof window !== "undefined"
    ? window.location.pathname.replace(/^\/review\//, "").split("/")[0] || ""
    : "";

  const [step, setStep] = useState<Step>("loading");
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [hoveredStar, setHoveredStar] = useState(0);
  const [selectedRating, setSelectedRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleReviewUrl, setGoogleReviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStep("error");
      setErrorMsg("Invalid review link.");
      return;
    }
    fetch(`/api/review/token/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "This review link is invalid or has expired.");
        }
        return res.json();
      })
      .then((data: TokenData) => {
        setTokenData(data);
        setGoogleReviewUrl(data.googleReviewUrl);
        setStep("rating");
      })
      .catch((err) => {
        setErrorMsg(err.message);
        setStep("error");
      });
  }, [token]);

  async function handleStarClick(rating: number) {
    setSelectedRating(rating);
    try {
      const res = await fetch("/api/review/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record rating");
      if (data.googleReviewUrl) setGoogleReviewUrl(data.googleReviewUrl);
      if (data.branch === "positive") {
        setStep("positive");
      } else {
        setStep("negative");
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStep("error");
    }
  }

  async function handleSubmitFeedback() {
    if (feedbackText.trim().length < 10) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/review/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, feedbackText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit feedback");
      setStep("submitted");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStep("error");
    } finally {
      setSubmitting(false);
    }
  }

  const companyName = tokenData?.companyName || "Your service provider";
  const firstName = tokenData?.contactFirstName || "there";

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white dark:from-gray-900 dark:to-gray-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          {tokenData?.companyLogoUrl ? (
            <img
              src={tokenData.companyLogoUrl}
              alt={companyName}
              className="h-16 w-16 rounded-xl object-cover mx-auto mb-3 shadow-sm"
              data-testid="img-company-logo"
            />
          ) : (
            <div className="h-16 w-16 rounded-xl bg-green-600 flex items-center justify-center mx-auto mb-3 shadow-sm">
              <span className="text-white text-2xl font-bold">{companyName[0]}</span>
            </div>
          )}
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100" data-testid="text-company-name">
            {companyName}
          </h1>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-800 p-8">

          {step === "loading" && (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-green-600" />
              <p className="text-gray-500 dark:text-gray-400 text-sm">Loading your review page…</p>
            </div>
          )}

          {step === "error" && (
            <div className="flex flex-col items-center py-6 gap-4 text-center">
              <AlertTriangle className="h-12 w-12 text-amber-500" />
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Oops!</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm" data-testid="text-error-message">{errorMsg}</p>
            </div>
          )}

          {step === "rating" && (
            <div className="text-center space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2" data-testid="heading-step1">
                  How was your service today?
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  Your feedback means the world to our local team.
                </p>
              </div>
              <div
                className="flex justify-center gap-3 py-2"
                onMouseLeave={() => setHoveredStar(0)}
                data-testid="star-rating-widget"
              >
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => handleStarClick(star)}
                    onMouseEnter={() => setHoveredStar(star)}
                    className="focus:outline-none transition-transform hover:scale-110 active:scale-95"
                    aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
                    data-testid={`star-${star}`}
                  >
                    <Star
                      className={`h-12 w-12 transition-colors ${
                        star <= (hoveredStar || selectedRating)
                          ? "fill-yellow-400 text-yellow-400"
                          : "fill-gray-100 text-gray-300 dark:fill-gray-700 dark:text-gray-600"
                      }`}
                    />
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">Tap a star to continue</p>
            </div>
          )}

          {step === "positive" && (
            <div className="text-center space-y-6">
              <div className="text-5xl">🎉</div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3" data-testid="heading-positive">
                  You just made our day!
                </h2>
                <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                  Thank you so much — we're thrilled your yard is looking great. We're a small local team, and reviews like yours are how our neighbors find us and trust us with their homes. It only takes 30 seconds, and it makes a huge difference.
                </p>
              </div>
              {googleReviewUrl ? (
                <a
                  href={googleReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3.5 px-6 rounded-xl text-base transition-colors shadow-sm"
                  data-testid="link-post-google-review"
                >
                  <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                  Post Your Review on Google
                </a>
              ) : (
                <p className="text-gray-400 text-sm">Thank you for your feedback!</p>
              )}
            </div>
          )}

          {step === "negative" && (
            <div className="space-y-5">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3" data-testid="heading-negative">
                  We're sorry we let you down.
                </h2>
                <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                  We take every visit seriously, and it sounds like we missed the mark today. Please tell us what happened — your feedback goes directly to our owner and we'll follow up personally to make it right.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="feedback-text" className="text-sm font-medium">
                  What could we have done better? <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="feedback-text"
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="Please share what happened…"
                  rows={4}
                  className="resize-none"
                  data-testid="textarea-feedback"
                />
                {feedbackText.length > 0 && feedbackText.trim().length < 10 && (
                  <p className="text-xs text-red-500">Please provide at least 10 characters.</p>
                )}
              </div>
              <Button
                onClick={handleSubmitFeedback}
                disabled={submitting || feedbackText.trim().length < 10}
                className="w-full bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white font-semibold py-3 rounded-xl"
                data-testid="button-submit-feedback"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
                ) : (
                  "Submit Feedback to Management"
                )}
              </Button>
              {googleReviewUrl && (
                <p className="text-center text-xs text-gray-400 mt-2">
                  Alternatively, you can still{" "}
                  <a
                    href={googleReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-gray-600 transition-colors"
                    data-testid="link-public-review-compliance"
                  >
                    leave a public review here
                  </a>.
                </p>
              )}
            </div>
          )}

          {step === "submitted" && (
            <div className="flex flex-col items-center py-6 gap-4 text-center">
              <CheckCircle2 className="h-14 w-14 text-green-500" />
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2" data-testid="heading-submitted">
                  Thank you, {firstName}!
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
                  Your feedback has been sent to our owner and we'll be in touch soon to make things right. We appreciate you taking the time.
                </p>
              </div>
              {googleReviewUrl && (
                <div className="mt-2 pt-4 border-t border-gray-100 dark:border-gray-800 w-full text-center">
                  <p className="text-xs text-gray-400">
                    You can also{" "}
                    <a
                      href={googleReviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-gray-600 transition-colors"
                      data-testid="link-submitted-public-review"
                    >
                      leave a public review
                    </a>{" "}
                    if you'd like.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">Powered by ScooPilot</p>
      </div>
    </div>
  );
}
