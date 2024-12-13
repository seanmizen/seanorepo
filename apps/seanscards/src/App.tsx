import {
  Box,
  TextField,
  CssBaseline,
  ThemeProvider,
  Button,
  Backdrop,
  CircularProgress,
} from "@mui/material";
import { darkTheme, lightTheme } from "./theme";
import { useCallback, useEffect, useState } from "react";
import { useFormik } from "formik";
import { object, string } from "yup";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";

// https://docs.stripe.com/checkout/embedded/quickstart

const stripePromise = loadStripe(
  "pk_test_51QVX2JBsGhYF8YEWrWYtL7QL0oA5XoOD1YFZEFxlSVAaX6ob6iUWHju4Nrkj4fzrtjcdF7ntlhPZGIMq944HLGb9006Raprd5x"
);

const placeholderMessages = [
  `Dear John,
  It's been a while,
  Merry Chrimbo.
  Be good.
  From Chris!`,
  `Dear Nana,
  I hope the back is holding out.
  Merry Christmas!
  I love you lots. From Sean ❤️`,
  `Mummy,
  Don't forget to feed the cat,
  love from Beth! xxx`,
  `Mr and Mrs M+C,
  Have a great Christmas.
  Hope little bump comes out soon!
  Much love, Me!`,
];

const windowIsMobile = () => window.innerWidth < 800;

type FormShape = {
  email: string;
  message: string;
  address: string;
};

const formSchema = object().shape({
  email: string().email("Invalid email").required("Required"),
  message: string().max(500, "Too long!").required("Required"),
  address: string().required("Required"),
});

const getOppositeThemeKey = (
  themeKey: string | null,
  prefersDarkMatches: boolean
) => {
  // if we have a non-null themeKey, use that
  if (themeKey === "dark") return "light";
  if (themeKey === "light") return "dark";
  // otherwise, use the system preference
  return prefersDarkMatches ? "light" : "dark";
};

/**
 * haha. they said we couldn't do it. they said it was impossible.
 * but we did it. a single-page application. with a single page.
 */
const App = () => {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)"); // give this a refresh every render, why not
  const [themeKey, setThemeKey] = useState<string | null>(null);
  const [theme, setTheme] = useState(
    prefersDark.matches ? darkTheme : lightTheme
  );
  // first useEffect listens to the system theme preference
  useEffect(() => {
    prefersDark.addEventListener("change", (e) => {
      setThemeKey(null);
      if (e.matches) {
        setTheme(darkTheme);
      } else {
        setTheme(lightTheme);
      }
    });
    return () => {
      prefersDark.removeEventListener("change", () => {});
    };
  }, []);
  // second useEffect listens to the themeKey state (user-initiated theme change)
  useEffect(() => {
    if (themeKey === "dark") setTheme(darkTheme);
    else if (themeKey === "light") setTheme(lightTheme);
    else setTheme(prefersDark.matches ? darkTheme : lightTheme);
  }, [themeKey, prefersDark.matches]);
  const [isMobile, setIsMobile] = useState(windowIsMobile());
  useEffect(() => {
    window.addEventListener("resize", () => {
      setIsMobile(windowIsMobile());
    });
    return () => {
      window.removeEventListener("resize", () => {});
    };
  }, []);

  const formik = useFormik<FormShape>({
    initialValues: {
      email: "",
      message: "",
      address: "",
    },
    validationSchema: formSchema,
    onSubmit: (values) => {
      alert(JSON.stringify(values, null, 2));
    },
  });

  const formikPropsForField = (fieldName: keyof FormShape) => ({
    id: fieldName,
    name: fieldName,
    value: formik.values[fieldName],
    onChange: formik.handleChange,
    error: formik.touched[fieldName] && !!formik.errors[fieldName],
  });

  const [isLoading, setIsLoading] = useState(false);

  const getRandomIndex = (max: number) => ~~(max * Math.random());
  const [randomPlaceholderIndex, setRandomPlaceholderIndex] = useState(
    getRandomIndex(placeholderMessages.length)
  );

  const fetchClientSecret = useCallback(() => {
    // Create a Checkout Session
    return fetch("/create-checkout-session", {
      method: "POST",
    })
      .then((res) => res.json())
      .then((data) => data.clientSecret);
  }, []);

  const embeddedStripeOptions = { fetchClientSecret };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* whole page and styles box: */}
      <Box
        sx={{
          display: "flex",
          minHeight: "100vh",
          lineHeight: 1.1,
          textAlign: "center",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          h1: {
            fontSize: "3.6rem",
            fontWeight: 700,
          },
          p: {
            fontSize: "1.2rem",
            fontWeight: 400,
            opacity: 0.5,
          },
        }}
      >
        <Box
          sx={{
            maxWidth: "600px",
            paddingTop: "20px",
          }}
        >
          <Box
            component={"p"}
            sx={{
              whiteSpace: "pre-wrap",
            }}
          >
            Handwritten cards by Sean - posted straight to your family.
            {`\n`}Or whoever!
          </Box>
          {/* two card designs, side by side. "" */}
          <Box
            sx={{
              width: "100%",
              maxWidth: "600px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              alignItems: "center",
              padding: "20px",
            }}
            component={"form"}
            onSubmit={formik.handleSubmit}
            noValidate
          >
            <TextField
              label="Your card's message"
              variant="outlined"
              multiline
              className="message"
              onFocus={() =>
                setRandomPlaceholderIndex(
                  getRandomIndex(placeholderMessages.length)
                )
              }
              placeholder={placeholderMessages[randomPlaceholderIndex]}
              minRows={isMobile ? 5 : 10}
              sx={{ width: "400px" }}
              {...formikPropsForField("message")}
            />

            <TextField
              label="Your email"
              variant="outlined"
              sx={{ width: "400px" }}
              {...formikPropsForField("email")}
            />
            <TextField
              label="Recipient's postal address"
              variant="outlined"
              placeholder="Dr Watson, 221B Baker Street, London, NW1 6XE"
              multiline
              minRows={isMobile ? 3 : 5}
              sx={{ width: "400px" }}
              {...formikPropsForField("address")}
            />
          </Box>
          <Box
            display={"none"}
            component={"p"}
            sx={{
              maxWidth: "600px",
              whiteSpace: "pre-wrap",
            }}
          >
            Double check your email address and the recipient's postal address.
            {`\n`}
            There's no sign-up here - once you've paid, it's on the way!
            {`\n`}
            {`\n`}No mailing list, no cookies, no tracking. Just a card,
            handwritten with care, sent wherever you like in the UK.
            {`\n`}
            {`\n`}
            If you want it to arrive before Christmas,{" "}
            <a
              target="#"
              href="https://www.royalmail.com/christmas/last-posting-dates"
            >
              Check the Royal Mail guide
            </a>
            ,{` `}
            and leave me 24 hours to process your order. Thanks!
          </Box>
          <Button type="submit" variant="contained">
            Submit
          </Button>
          <Button
            type="button"
            variant="contained"
            onClick={() => setIsLoading(!isLoading)}
          >
            Loading!
          </Button>
          <Backdrop
            sx={(theme) => ({ color: "#fff", zIndex: theme.zIndex.drawer + 1 })}
            open={isLoading}
            onClick={() => setIsLoading(false)}
          >
            <CircularProgress color="inherit" />
          </Backdrop>
          <Button
            type="button"
            variant="contained"
            onClick={() =>
              setThemeKey(getOppositeThemeKey(themeKey, prefersDark.matches))
            }
          >{`Switch to ${getOppositeThemeKey(themeKey, prefersDark.matches)} mode`}</Button>
          <EmbeddedCheckoutProvider
            stripe={stripePromise}
            options={embeddedStripeOptions}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default App;

// videos:
// "enterprising young men - star trek" and just writing the stuff with like "skdoosh" sound effects into the bin for bad cards
// "the final countdown - europe" and just like a countdown to the card being sent
// Christmassy song, fireplace, writing stationery, writing a card, sealing it, putting it in the mailbox, mailbox closing, card flying through the air, card landing in the recipient's hands

// I hate this corporatised mailchimp stuff.
// it's simple: you give me your email, and a message, and I'll send your card for £4.99.
// You'll get a confirmation email, and a tracking number.
// I don't do anything with your email. I don't use cookies. I don't track you.
// It's just a card site, man

// I bought the domain seanscards.com, and seanscards.co.uk (it felt necessary - Saito, Inception)

// HAVE to do a Terry Pratchett "Embuggerance" video.
// "I'm sorry, you have an embuggerance. It's a rare condition, but it's terminal. You have 24 hours to live."
