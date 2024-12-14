import {
  Box,
  TextField,
  CssBaseline,
  ThemeProvider,
  Button,
  Backdrop,
  CircularProgress,
  Skeleton,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Radio,
  Accordion,
  AccordionDetails,
  AccordionSummary,
} from "@mui/material";
import { ExpandMore } from "@mui/icons-material";
import { darkTheme, lightTheme } from "./theme";
import { SetStateAction, useEffect, useState } from "react";
import { useFormik } from "formik";
import { object, string } from "yup";
import { Appearance, loadStripe } from "@stripe/stripe-js";
import { CheckoutForm } from "./CheckoutForm";
import { Elements } from "@stripe/react-stripe-js";

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
const fakeAddresses = [
  `Dr Watson, 221B Baker Street, London, NW1 6XE`,
  `Mr and Mrs M+C, 12 The Lane, London, NW1 6XE`,
  `HM The King, Buckingham Palace, London, SW1A 1AA`,
  `Mr and Mrs Kringle, The North Pole, H0H 0H0`,
];

const windowIsMobile = () => window.innerWidth < 800;

type FormShape = {
  message: string;
  address: string;
  email: string;
};

type CardDesign = "Robin and Ivy" | "Stuffed Toys";

const formSchema = object().shape({
  message: string()
    .max(1120, `Too long! Keep it under 1120 characters pls xxx`)
    .min(1, "Too short!")
    .required("Need to enter a message for your card!"),
  address: string()
    .min(1, "Too short!")
    .required("Please enter a postal address!"),
  email: string()
    .email("Invalid email")
    .min(5, "Too short!")
    .required(
      "We need your email to send a confirmation! (I don't do tracking or junk mail)"
    ),
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
  const appearance: Appearance = {
    theme: theme.palette.mode === "dark" ? "night" : "stripe",
  };
  const loader = "auto";

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
      message: "",
      address: "",
      email: "",
    },
    isInitialValid: false,
    validateOnBlur: true,
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
    helperText:
      formik.touched[fieldName] && !!formik.errors[fieldName]
        ? formik.errors[fieldName]
        : undefined,
  });

  const [isLoading, setIsLoading] = useState(false);

  const getRandomIndex = (max: number) => ~~(max * Math.random());
  const [randomPlaceholderIndex, setRandomPlaceholderIndex] = useState(
    getRandomIndex(placeholderMessages.length)
  );
  const [randomAddressIndex, setRandomAddressIndex] = useState(
    getRandomIndex(fakeAddresses.length)
  );

  // useEffect(() => {
  //   const urlParams = new URLSearchParams(window.location.search);
  //   const sessionId = urlParams.get("session_id");
  //   if (sessionId) {
  //     fetch(`http://localhost:4242/session-status?session_id=${sessionId}`)
  //       .then((res) => res.json())
  //       .then((data) => {
  //         console.log("payment response:", data);
  //       })
  //       .catch((error) => {
  //         console.error("Error fetching session status:", error);
  //         alert("Something happened on the backend. Sorry!");
  //       });
  //     window.history.replaceState({}, document.title, "/");
  //   }
  // }, []);

  // https://docs.stripe.com/payments/quickstart

  const [clientSecret, setClientSecret] = useState("");
  const [dpmCheckerLink, setDpmCheckerLink] = useState("");

  useEffect(() => {
    // Create PaymentIntent as soon as the page loads
    fetch("http://localhost:4242/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: "xl-tshirt", amount: 1000 }] }),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("gorren", data);
        setClientSecret(data.clientSecret);
        // [DEV] For demo purposes only
        setDpmCheckerLink(data.dpmCheckerLink);
      });
  }, []);

  const [selected, setSelected] = useState<CardDesign>("Robin and Ivy");
  const handleSelect = (val: SetStateAction<CardDesign>) => setSelected(val);

  // Open accordion
  // A: once form is complete
  // B: if opened by clicking
  // const [showCheckout, setShowCheckout] = useState(false);
  // useEffect(() => {
  //   if (formik.dirty && formik.touched) {
  //     console.log("huzzah!");
  //     setShowCheckout(true);
  //   }
  // }, [formik.dirty, formik.isValid]);

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
              marginBlock: "20px",
            }}
            component={"form"}
            onSubmit={formik.handleSubmit}
            // noValidate
          >
            <Box display="flex" gap={2}>
              <Card
                sx={{
                  maxWidth: 200,
                  border:
                    selected === "Robin and Ivy" ? "2px solid blue" : "none",
                }}
              >
                <CardActionArea onClick={() => handleSelect("one")}>
                  <CardMedia
                    component="img"
                    height="140"
                    image="https://i.postimg.cc/gXFCHh5M/Robin-Ivy.jpg"
                  />
                  <CardContent>
                    <Radio checked={selected === "Robin and Ivy"} />
                    Robin and Ivy
                  </CardContent>
                </CardActionArea>
              </Card>

              <Card
                sx={{
                  maxWidth: 200,
                  border:
                    selected === "Stuffed Toys" ? "2px solid blue" : "none",
                }}
              >
                <CardActionArea onClick={() => handleSelect("two")}>
                  <CardMedia
                    component="img"
                    height="140"
                    // image="../assets/Stuffed Toys.jpg"
                    image="https://i.postimg.cc/2bQPc6NC/Stuffed-Toys.jpg"
                  />
                  <CardContent>
                    <Radio checked={selected === "Stuffed Toys"} />
                    Stuffed Toys
                  </CardContent>
                </CardActionArea>
              </Card>
            </Box>
            <Box
              // component={"p"}
              sx={{
                whiteSpace: "pre-wrap",
              }}
            >
              Designs by Mum
              <a href="https://www.instagram.com/caroline.mizen/">
                @caroline.mizen
              </a>
            </Box>

            <TextField
              label="Full card message"
              variant="outlined"
              multiline
              className="message"
              minRows={isMobile ? 5 : 10}
              sx={{ width: "400px" }}
              onFocus={() =>
                setRandomPlaceholderIndex(
                  getRandomIndex(placeholderMessages.length)
                )
              }
              placeholder={placeholderMessages[randomPlaceholderIndex]}
              {...formikPropsForField("message")}
            />
            <TextField
              label="Recipient's postal address"
              variant="outlined"
              multiline
              minRows={isMobile ? 3 : 5}
              sx={{ width: "400px" }}
              onFocus={() =>
                setRandomAddressIndex(getRandomIndex(fakeAddresses.length))
              }
              placeholder={fakeAddresses[randomAddressIndex]}
              {...formikPropsForField("address")}
            />
            <TextField
              label="Your email address"
              variant="outlined"
              sx={{ width: "400px" }}
              {...formikPropsForField("email")}
            />
            {/* <Button type="submit" variant="contained" /> */}
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
          <div id="checkout">
            {/* Payment succeeds
              4242 4242 4242 4242

              Payment requires authentication
              4000 0025 0000 3155

              Payment is declined
              4000 0000 0000 9995
              */}
          </div>
          {/* <Accordion
            expanded={showCheckout}
            onChange={() => setShowCheckout(!showCheckout)}
          >
            <AccordionSummary
              expandIcon={<ExpandMore />}
              aria-controls="panel1-content"
              id="panel1-header"
            >
              Payment
            </AccordionSummary>
            <AccordionDetails> */}
          {clientSecret ? (
            <Box minHeight={"600px"}>
              <Elements
                options={{ clientSecret, appearance, loader }}
                stripe={stripePromise}
              >
                <CheckoutForm
                  dpmCheckerLink={dpmCheckerLink}
                  isFormReady={formik.touched && formik.isValid}
                />
              </Elements>
            </Box>
          ) : (
            <Skeleton variant="rectangular" width="100%" height="600px" />
          )}
          {/* </AccordionDetails>
          </Accordion> */}
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
            sx={{ marginTop: "20px", marginBottom: "20px" }}
            onClick={() =>
              setThemeKey(getOppositeThemeKey(themeKey, prefersDark.matches))
            }
          >{`Switch to ${getOppositeThemeKey(themeKey, prefersDark.matches)} mode`}</Button>
        </Box>
      </Box>
      {/* "Elements" might go elsewhere */}
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
