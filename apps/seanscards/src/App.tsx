import {
  Box,
  TextField,
  CssBaseline,
  ThemeProvider,
  Backdrop,
  CircularProgress,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Radio,
  Alert,
  Fade,
  Modal,
  Accordion,
  AccordionDetails,
  AccordionSummary,
} from "@mui/material";
import { darkTheme, lightTheme } from "./theme";
import { FC, useCallback, useEffect, useState } from "react";
import { useFormik } from "formik";
import { object, string } from "yup";
import { loadStripe } from "@stripe/stripe-js";
import { configs, ConfigType } from "../configs";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";

// until specified otherwise...
const config: ConfigType = configs[process.env.NODE_ENV || "development"];

console.info(
  "running on ",
  process.env.NODE_ENV || "development",
  "appDomain",
  config.appDomain
);

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
const windowIsBigEnoughForSideBySide = () => window.innerWidth > 1250;

type CardDesign = "Robin and Ivy" | "Stuffed Toys";

type FormShape = {
  selectedCardDesign: CardDesign;
  message: string;
  address: string;
  email: string;
};

const formSchema = object()
  .required()
  .shape({
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
    selectedCardDesign: string().oneOf(
      ["Robin and Ivy", "Stuffed Toys"],
      "Please select a card design!"
    ),
  });
// .required();

// const getOppositeThemeKey = (
//   themeKey: string | null,
//   prefersDarkMatches: boolean
// ) => {
//   // if we have a non-null themeKey, use that
//   if (themeKey === "dark") return "light";
//   if (themeKey === "light") return "dark";
//   // otherwise, use the system preference
//   return prefersDarkMatches ? "light" : "dark";
// };

const fetchSessionToken: () => Promise<string> = async () => {
  return fetch(`${config.serverApiPath}/session-token`)
    .then((res) => res.text())
    .then((data) => data);
};

// component which checks `config.serverApiPath` for a response
// if it gets no response, it displays a message saying "The server is down"
const ServerChecker: FC = () => {
  const [initialRender, setInitialRender] = useState(true);
  const [isServerDown, setIsServerDown] = useState(false);
  const [displayAlert, setDisplayAlert] = useState(true);

  const checkServerStatus = () => {
    fetch(config.serverApiPath)
      .then((res) => res.json())
      .then(() => setIsServerDown(false))
      .catch(() => setIsServerDown(true))
      .finally(() => setInitialRender(false));
  };

  useEffect(() => {
    checkServerStatus();
  }, []);

  const severity = initialRender ? "info" : isServerDown ? "error" : "success";
  const message = initialRender
    ? "Checking server status..."
    : isServerDown
      ? "The server is down"
      : `The server is up!`;

  useEffect(() => {
    if (!initialRender && !isServerDown) {
      const timeout = setTimeout(() => setDisplayAlert(false), 3000);
      return () => clearTimeout(timeout);
    }
  }, [initialRender, isServerDown]);

  return (
    <Fade in={displayAlert} appear={false} timeout={500} unmountOnExit>
      <Alert
        severity={severity}
        sx={{
          position: "absolute",
          top: 20,
          right: 20,
          cursor: "pointer",
        }}
        onClick={checkServerStatus}
      >
        {message}
      </Alert>
    </Fade>
  );
};

/**
 * haha. they said we couldn't do it. they said it was impossible.
 * but we did it. a single-page application. with a single page.
 */
const App = () => {
  // Sean's Jank Solution to order processing:
  // session token: get one from BE on page load.
  // on form completion, send the form data and the session token to the BE.
  // so when we receive the Stripe session ID, we can match it to the session token.
  // match that to a payment, and then we can send the card.
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  useEffect(() => {
    fetchSessionToken().then((token) => setSessionToken(token));
  }, []);

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)"); // give this a refresh every render, why not
  const [themeKey, setThemeKey] = useState<string | null>(null);
  const [, setTheme] = useState(prefersDark.matches ? darkTheme : lightTheme);
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
  const [isBigEnoughForSideBySide, setIsBigEnoughForSideBySide] = useState(
    windowIsBigEnoughForSideBySide()
  );
  // const appearance: Appearance = {
  //   // theme: theme.palette.mode === "dark" ? "night" : "stripe",
  //   theme: "stripe",
  // };
  const loader = "auto";

  useEffect(() => {
    window.addEventListener("resize", () => {
      setIsMobile(windowIsMobile());
      setIsBigEnoughForSideBySide(windowIsBigEnoughForSideBySide());
    });
    return () => {
      window.removeEventListener("resize", () => {});
    };
  }, []);

  const formik = useFormik<FormShape>({
    initialValues: {
      selectedCardDesign: "Robin and Ivy",
      message: "",
      address: "",
      email: "",
    },
    isInitialValid: false,
    validateOnBlur: true,
    // validateOnChange: false,
    validationSchema: formSchema,
    onSubmit: (values) => {
      alert(JSON.stringify(values, null, 2));
    },
  });

  const updateSessionFields = () => {
    // "submit" formik values to the backend with session token
    fetch(`${config.serverApiPath}/update-session-fields`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionToken,
        stripeSessionId: latestSessionId,
        ...formik.values,
      }),
    })
      .then((res) => res.json())
      .catch((error) => {
        console.error("Error submitting form:", error);
      });
  };

  // hack: update API when formik values change
  useEffect(() => {
    formik.dirty || (formik.values.email && updateSessionFields());
  }, [formik.values.selectedCardDesign]);

  const formikPropsForField = (fieldName: keyof FormShape) => ({
    id: fieldName,
    name: fieldName,
    value: formik.values[fieldName],
    onChange: formik.handleChange,
    onBlur: (e: any) => {
      formik.dirty && formik.handleBlur(e);
      updateSessionFields();
    },
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

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState({
    title: "Why am I open? Merry Christmas! 🎄🎄🎄",
    body: "I am a modal. Hello.",
    accordion: `accordion\nnew line\ninfo`,
  });

  const [latestSessionId, setLatestSessionId] = useState<string | null>(null);
  const fetchClientSecret = useCallback(() => {
    // Create a Checkout Session
    return fetch(`${config.serverApiPath}/create-checkout-session`, {
      method: "POST",
    })
      .then((res) => res.json())
      .then((data) => {
        // here's our custom stuff, we can do whatever here (and add any extra stuff if we want)
        setLatestSessionId(data.sessionId);
        // and here's Stripe's expected return
        // options.fetchClientSecret is expected to resolve to string
        return data.clientSecret;
      });
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const stripeSessionId = urlParams.get("session_id");
    if (stripeSessionId) {
      fetch(
        `${config.serverApiPath}/session-status?session_id=${stripeSessionId}`
      )
        .then((res) => res.json())
        .then((data) => {
          setModalMessage({
            title: "Card sent!",
            body: "Thanks for your order. Merry Christmas! 🎄🎄🎄\nYou can go right in and make a new order, if you'd like. Thanks again.",
            accordion: `Session:\n${stripeSessionId}\n${JSON.stringify(data, null, 2)}`,
            // { "status": "complete", "customer_email": "sean@seanmizen.com" }
          });
          setModalOpen(true);
        })
        .catch((error) => {
          console.error("Error fetching session status:", error);
          setModalMessage({
            title: "Error! Sorry!",
            body: "Something went wrong. Please check your email for a confirmation.",
            accordion: `Session ${stripeSessionId}\n${JSON.stringify(error, null, 2)}`,
          });
          setModalOpen(true);
        });
      window.history.replaceState({}, document.title, "/");
    }
  }, []);

  const options = { fetchClientSecret };

  // https://docs.stripe.com/payments/quickstart

  // const [clientSecret, setClientSecret] = useState("");
  // const [dpmCheckerLink, setDpmCheckerLink] = useState("");

  // useEffect(() => {
  //   // Create PaymentIntent as soon as the page loads
  //   fetch(`${config.serverApiPath}/create-payment-intent`, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ items: [{ id: "xl-tshirt", amount: 1000 }] }),
  //   })
  //     .then((res) => res.json())
  //     .then((data) => {
  //       console.log("gorren", data);
  //       setClientSecret(data.clientSecret);
  //       // [DEV] For demo purposes only
  //       setDpmCheckerLink(data.dpmCheckerLink);
  //     });
  // }, []);
  const formikReady =
    formik.touched && formik.isValid && Object.keys(formik.touched).length > 1;
  const weCanProceedToCheckout = sessionToken && formikReady;

  return (
    <ThemeProvider theme={lightTheme}>
      <ServerChecker />
      <CssBaseline />
      <Box
        sx={{
          display: "flex",
          minHeight: "100vh",
          lineHeight: 1.1,
          textAlign: "center",
          flexDirection: isBigEnoughForSideBySide ? "row" : "column",
          gap: isBigEnoughForSideBySide ? 20 : 0,
          justifyContent: "center",
          alignItems: isBigEnoughForSideBySide ? "flex-start" : "center",
          h1: {
            fontSize: "3.6rem",
            fontWeight: 700,
          },
          p: {
            fontSize: "1.2rem",
            fontWeight: 400,
            color: "rgba(0, 0, 0, 0.7)",
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
            <Box id={"rah"} display="flex" gap={2}>
              <Card
                sx={{
                  maxWidth: 200,
                  border:
                    formik.values.selectedCardDesign === "Robin and Ivy"
                      ? "2px solid blue"
                      : "none",
                }}
              >
                <CardActionArea
                  onClick={() => {
                    formik.setFieldValue("selectedCardDesign", "Robin and Ivy");
                  }}
                >
                  <CardMedia
                    component="img"
                    height="140"
                    image="https://i.postimg.cc/gXFCHh5M/Robin-Ivy.jpg"
                  />
                  <CardContent>
                    <Radio
                      tabIndex={-1}
                      checked={
                        formik.values.selectedCardDesign === "Robin and Ivy"
                      }
                    />
                    Robin and Ivy
                  </CardContent>
                </CardActionArea>
              </Card>

              <Card
                sx={{
                  maxWidth: 200,
                  border:
                    formik.values.selectedCardDesign === "Stuffed Toys"
                      ? "2px solid blue"
                      : "none",
                }}
              >
                <CardActionArea
                  onClick={() => {
                    formik.setFieldValue("selectedCardDesign", "Stuffed Toys");
                  }}
                >
                  <CardMedia
                    component="img"
                    height="140"
                    image="https://i.postimg.cc/2bQPc6NC/Stuffed-Toys.jpg"
                  />
                  <CardContent>
                    <Radio
                      tabIndex={-1}
                      checked={
                        formik.values.selectedCardDesign === "Stuffed Toys"
                      }
                    />
                    Stuffed Toys
                  </CardContent>
                </CardActionArea>
              </Card>
            </Box>
            <Box
              sx={{
                fontSize: "0.8rem",
                color: "rgba(0, 0, 0, 0.6)",
                textAlign: "center",
              }}
            >
              (painted by the lovely{" "}
              <a target="#" href="https://www.instagram.com/caroline.mizen/">
                @caroline.mizen
              </a>
              )
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
        </Box>
        <Box
          sx={{
            maxWidth: "600px",
            paddingTop: "20px",
          }}
        >
          <Box id="checkout" position="relative" width="100%" height="100%">
            {/* Payment succeeds
              4242 4242 4242 4242

              Payment requires authentication
              4000 0025 0000 3155

              Payment is declined
              4000 0000 0000 9995
              */}
            <Box
              sx={{
                pointerEvents: weCanProceedToCheckout ? "unset" : "none",
                width: "100%",
                height: "100%",
                marginBlock: "20px",
              }}
            >
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={options}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </Box>
            {/* Overlay if we cannot proceed */}
            {!weCanProceedToCheckout && (
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  zIndex: 10,
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                  backgroundColor: "rgba(255, 255, 255, 0.6)",
                  whiteSpace: "pre-wrap",
                }}
              >
                Please complete the greetings card details first!
                {`\n`}I can't send a card without all the details!
              </Box>
            )}
          </Box>

          {/* NON-EMBEDDED BELOW: */}
          {/* {weCanProceedToCheckout ? (
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
          )} */}
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            aria-labelledby="modal-modal-title"
            aria-describedby="modal-modal-description"
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Card
              sx={{
                padding: "20px",
                minWidth: "400px",
                maxWidth: "600px",
              }}
            >
              <Box
                component={"p"}
                sx={{
                  // allow words to be cut off
                  whiteSpace: "pre-wrap",
                }}
              >
                {modalMessage.title}
              </Box>
              <Box
                component={"p"}
                sx={{
                  whiteSpace: "pre-wrap",
                }}
              >
                {modalMessage.body}
              </Box>
              <Accordion>
                <AccordionSummary>behind the scenes info...</AccordionSummary>
                <AccordionDetails
                  sx={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {modalMessage.accordion}
                </AccordionDetails>
              </Accordion>
            </Card>
          </Modal>
          <Backdrop
            sx={(theme) => ({ color: "#fff", zIndex: theme.zIndex.drawer + 1 })}
            open={isLoading}
            onClick={() => setIsLoading(false)}
          >
            <CircularProgress color="inherit" />
          </Backdrop>
          {/* <Button onClick={testServer}>tt</Button> */}
          {/* <Button
            type="button"
            variant="contained"
            sx={{ marginTop: "20px", marginBottom: "20px" }}
            onClick={() =>
              setThemeKey(getOppositeThemeKey(themeKey, prefersDark.matches))
            }
          >{`Switch to ${getOppositeThemeKey(themeKey, prefersDark.matches)} mode`}</Button> */}
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
