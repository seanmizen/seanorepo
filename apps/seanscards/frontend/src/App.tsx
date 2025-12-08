import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  CssBaseline,
  Fade,
  Modal,
  Radio,
  TextField,
} from '@mui/material';
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useFormik } from 'formik';
import { type FC, useCallback, useEffect, useState } from 'react';
import { object, string } from 'yup';
import { type ConfigType, configs } from '../../configs';

// until specified otherwise...
const env = process.env.NODE_ENV || 'development';
const config: ConfigType = configs[env];

// https://docs.stripe.com/checkout/embedded/quickstart
const stripePromise = loadStripe(config.stripePublicKey);

// we at Mother's day now bishes
const placeholderMessages = [
  `Mum, love you lots. Thinking of you this Mother's day!`,
  `Dear Mumma, I hope you're doing well. Love you lots!`,
  `To the best mum in the world, happy Mother's day!`,
  `Mum, you're the best. Hope you have a great day! Love, Arugela`,
];

const _christmasPlaceholderMessages = [
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
  love from Beth! xxx

  (Request drawings at your own peril.)`,
  `Mr and Mrs M+C,
  Have a great Christmas.
  Hope little bump comes out soon!
  Much love, Me!`,
];
const _christmasFakeAddresses = [
  `Dr Watson, 221B Baker Street, London, NW1 6XE`,
  `Mr and Mrs M+C, 12 The Lane, London, NW1 6XE`,
  `HM The King, Buckingham Palace, London, SW1A 1AA`,
  `Mr and Mrs Kringle, The North Pole, H0H 0H0`,
];
const fakeAddresses = [
  `Dr Watson, 221B Baker Street, London, NW1 6XE`,
  `Mrs C, 12 The Lane, London, NW1 6XE`,
  `HM The Queen, Buckingham Palace, London, SW1A 1AA`,
  `Mrs Kringle, The North Pole, H0H 0H0`,
];

const windowIsMobile = () => window.innerWidth < 800;
const windowIsBigEnoughForSideBySide = () => window.innerWidth > 1250;

// type CardDesign = "Robin and Ivy" | "Stuffed Toys";
type CardDesign =
  | 'Dancing'
  | 'Sunrise 01'
  | 'Abstract Music'
  | 'Sail into Venice';

type FormShape = {
  selectedCardDesign: CardDesign;
  message: string;
  address: string;
  email: string;
};

const cardDesigns: CardDesign[] = [
  'Dancing',
  'Sunrise 01',
  'Abstract Music',
  'Sail into Venice',
];

const formSchema = object()
  .required()
  .shape({
    message: string()
      .max(1120, `Too long! Keep it under 1120 characters pls xxx`)
      .min(1, 'Too short!')
      .required('Need to enter a message for your card!'),
    address: string()
      .min(1, 'Too short!')
      .required('Please enter a postal address!'),
    email: string()
      .email('Invalid email')
      .min(5, 'Too short!')
      .required(
        "We need your email to send a confirmation! (I don't do tracking or junk mail)",
      ),
    selectedCardDesign: string().oneOf(
      cardDesigns,
      'Please select a card design!',
    ),
  });

const fetchSessionToken: () => Promise<string> = async () => {
  return fetch(`${config.serverApiPath}/session-token`)
    .then((res) => res.text())
    .then((data) => data);
};

/**
 * Component which checks `config.serverApiPath` for a response.
 *
 * if it gets no response, it displays a message saying "The server is down"
 */
const ServerChecker: FC = () => {
  const [initialRender, setInitialRender] = useState(true);
  const [isServerDown, setIsServerDown] = useState(false);
  const [displayAlert, setDisplayAlert] = useState(false);

  const checkServerStatus = () => {
    fetch(config.serverApiPath)
      .then((res) => res.json())
      .then(() => setIsServerDown(false))
      .catch(() => setIsServerDown(true))
      .finally(() => {
        setInitialRender(false);
        setDisplayAlert(true);
      });
  };

  useEffect(() => {
    checkServerStatus();
  }, []);

  const severity = initialRender ? 'info' : isServerDown ? 'error' : 'success';
  const message = initialRender
    ? 'Checking server status...'
    : isServerDown
      ? 'The server is down'
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
          position: 'absolute',
          top: 20,
          left: 20,
          cursor: 'pointer',
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

  const [isMobile, setIsMobile] = useState(windowIsMobile());
  const [isBigEnoughForSideBySide, setIsBigEnoughForSideBySide] = useState(
    windowIsBigEnoughForSideBySide(),
  );

  useEffect(() => {
    window.addEventListener('resize', () => {
      setIsMobile(windowIsMobile());
      setIsBigEnoughForSideBySide(windowIsBigEnoughForSideBySide());
    });
    return () => {
      window.removeEventListener('resize', () => {});
    };
  }, []);

  const formik = useFormik<FormShape>({
    initialValues: {
      selectedCardDesign: 'Dancing',
      message: '',
      address: '',
      email: '',
    },
    isInitialValid: false,
    validateOnBlur: true,
    validationSchema: formSchema,
    onSubmit: (values) => {
      alert(JSON.stringify(values, null, 2));
    },
  });

  const updateSessionFields = () => {
    fetch(`${config.serverApiPath}/update-session-fields`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionToken,
        stripeSessionId: latestSessionId,
        ...formik.values,
      }),
    })
      .then((res) => res.json())
      .catch((error) => {
        console.error('Error submitting form:', error);
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
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      formik.dirty && formik.handleBlur(e);
      updateSessionFields();
    },
    error: formik.touched[fieldName] && !!formik.errors[fieldName],
    helperText:
      formik.touched[fieldName] && !!formik.errors[fieldName]
        ? formik.errors[fieldName]
        : undefined,
  });

  const getRandomIndex = (max: number) => ~~(max * Math.random());
  const [randomPlaceholderIndex, setRandomPlaceholderIndex] = useState(
    getRandomIndex(placeholderMessages.length),
  );
  const [randomAddressIndex, setRandomAddressIndex] = useState(
    getRandomIndex(fakeAddresses.length),
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState({
    title: 'Why am I open?',
    body: 'I am a modal. Hello.',
    accordion: `accordion\nnew line\ninfo`,
  });

  const [latestSessionId, setLatestSessionId] = useState<string | null>(null);
  const fetchClientSecret = useCallback(() => {
    return fetch(`${config.serverApiPath}/create-checkout-session`, {
      method: 'POST',
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
    const stripeSessionId = urlParams.get('session_id');
    if (stripeSessionId) {
      fetch(
        `${config.serverApiPath}/session-status?session_id=${stripeSessionId}`,
      )
        .then((res) => res.json())
        .then((data) => {
          setModalMessage({
            title: 'Card sent!',
            body: "Thanks for your order!\nYou can go right in and make a new order, if you'd like. But you only have one mother, I assume. Thanks again.",
            accordion: `Session:\n${stripeSessionId}\n${JSON.stringify(data, null, 2)}`,
          });
          setModalOpen(true);
        })
        .catch((error) => {
          console.error('Error fetching session status:', error);
          setModalMessage({
            title: 'Error! Sorry!',
            body: 'Something went wrong. Please check your email for a confirmation.',
            accordion: `Session ${stripeSessionId}\n${JSON.stringify(error, null, 2)}`,
          });
          setModalOpen(true);
        });
      window.history.replaceState({}, document.title, '/');
    }
  }, []);

  const options = { fetchClientSecret };

  const formikReady =
    formik.touched && formik.isValid && Object.keys(formik.touched).length > 1;
  const weCanProceedToCheckout = sessionToken && formikReady;

  return (
    <>
      <ServerChecker />
      <CssBaseline />
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          lineHeight: 1.1,
          textAlign: 'center',
          flexDirection: isBigEnoughForSideBySide ? 'row' : 'column',
          gap: isBigEnoughForSideBySide ? 20 : 0,
          justifyContent: 'center',
          alignItems: isBigEnoughForSideBySide ? 'flex-start' : 'center',
          h1: {
            fontSize: '3.6rem',
            fontWeight: 700,
          },
          p: {
            fontSize: '1.2rem',
            fontWeight: 400,
            color: 'rgba(0, 0, 0, 0.7)',
          },
        }}
      >
        <Box
          sx={{
            maxWidth: '600px',
            paddingTop: '20px',
          }}
        >
          <Box
            component={'p'}
            sx={{
              whiteSpace: 'pre-wrap',
              margin: '20px',
            }}
          >
            SEANSCARDS IS OUT OF SEASON - THANKS FOR YOUR INTEREST!
          </Box>
          <Box
            sx={{
              width: '100%',
              maxWidth: '600px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              alignItems: 'center',
              // alignItems: "space-between",
              padding: '20px',
              marginBlock: '20px',
            }}
            component={'form'}
            onSubmit={formik.handleSubmit}
            // noValidate
          >
            <Box
              id={'rah'}
              gap={2}
              sx={{
                display: 'flex',
                alignContent: 'space-between',
                justifyContent: 'space-between',
              }}
            >
              <Card
                sx={{
                  maxWidth: 200,
                  border:
                    formik.values.selectedCardDesign === 'Dancing'
                      ? '2px solid blue'
                      : 'none',
                }}
              >
                <CardActionArea
                  onClick={() => {
                    formik.setFieldValue('selectedCardDesign', 'Dancing');
                  }}
                >
                  <CardMedia
                    component="img"
                    height="140"
                    image="https://i.postimg.cc/dQLxn4L0/Dancing-A6.jpg"
                  />
                  <CardContent>
                    <Radio
                      tabIndex={-1}
                      checked={formik.values.selectedCardDesign === 'Dancing'}
                    />
                    Dancing
                  </CardContent>
                </CardActionArea>
              </Card>

              <Card
                sx={{
                  maxWidth: 200,
                  border:
                    formik.values.selectedCardDesign === 'Sunrise 01'
                      ? '2px solid blue'
                      : 'none',
                }}
              >
                <CardActionArea
                  onClick={() => {
                    formik.setFieldValue('selectedCardDesign', 'Sunrise 01');
                  }}
                >
                  <CardMedia
                    component="img"
                    height="140"
                    image="https://i.postimg.cc/8PvngcdQ/Sunrise-01.jpg"
                  />
                  <CardContent>
                    <Radio
                      tabIndex={-1}
                      checked={
                        formik.values.selectedCardDesign === 'Sunrise 01'
                      }
                    />
                    Sunrise 01
                  </CardContent>
                </CardActionArea>
              </Card>
            </Box>
            <Box
              id={'rah'}
              gap={2}
              sx={{
                display: 'flex',
                alignContent: 'space-between',
                justifyContent: 'space-between',
              }}
            >
              <Card
                sx={{
                  maxWidth: 200,
                  border:
                    formik.values.selectedCardDesign === 'Abstract Music'
                      ? '2px solid blue'
                      : 'none',
                }}
              >
                <CardActionArea
                  onClick={() => {
                    formik.setFieldValue(
                      'selectedCardDesign',
                      'Abstract Music',
                    );
                  }}
                >
                  <CardMedia
                    component="img"
                    height="140"
                    image="https://i.postimg.cc/4Zxkm14q/Abstract-Music.jpg"
                  />
                  <CardContent>
                    <Radio
                      tabIndex={-1}
                      checked={
                        formik.values.selectedCardDesign === 'Abstract Music'
                      }
                    />
                    Abstract Music
                  </CardContent>
                </CardActionArea>
              </Card>

              <Card
                sx={{
                  maxWidth: 200,
                  border:
                    formik.values.selectedCardDesign === 'Sail into Venice'
                      ? '2px solid blue'
                      : 'none',
                }}
              >
                <CardActionArea
                  onClick={() => {
                    formik.setFieldValue(
                      'selectedCardDesign',
                      'Sail into Venice',
                    );
                  }}
                >
                  <CardMedia
                    component="img"
                    height="140"
                    image="https://i.postimg.cc/6pNbWKz7/Sail-into-Venice.jpg"
                  />
                  <CardContent>
                    <Radio
                      tabIndex={-1}
                      checked={
                        formik.values.selectedCardDesign === 'Sail into Venice'
                      }
                    />
                    Sail into Venice
                  </CardContent>
                </CardActionArea>
              </Card>
            </Box>
            <Box
              sx={{
                fontSize: '0.8rem',
                color: 'rgba(0, 0, 0, 0.6)',
                textAlign: 'center',
              }}
            >
              (painted by the lovely{' '}
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
              sx={{
                width: '100%',
                maxWidth: '400px',
              }}
              onFocus={() =>
                setRandomPlaceholderIndex(
                  getRandomIndex(placeholderMessages.length),
                )
              }
              placeholder={
                placeholderMessages[randomPlaceholderIndex] +
                '\n\n[Special requests in square brackets please!]'
              }
              {...formikPropsForField('message')}
            />
            <TextField
              label="Recipient's postal address"
              variant="outlined"
              multiline
              minRows={isMobile ? 3 : 5}
              sx={{
                width: '100%',
                maxWidth: '400px',
              }}
              onFocus={() =>
                setRandomAddressIndex(getRandomIndex(fakeAddresses.length))
              }
              placeholder={fakeAddresses[randomAddressIndex]}
              {...formikPropsForField('address')}
            />
            <TextField
              label="Your email address"
              variant="outlined"
              sx={{
                width: '100%',
                maxWidth: '400px',
              }}
              {...formikPropsForField('email')}
            />
          </Box>
        </Box>
        <Box
          sx={{
            maxWidth: '600px',
            paddingTop: '20px',
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
                pointerEvents: weCanProceedToCheckout
                  ? 'unset'
                  : isMobile
                    ? 'unset'
                    : 'none',
                width: '100%',
                height: '100%',
                marginBlock: '20px',
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
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  zIndex: 1,
                  width: '100%',
                  height: '100%',
                  display: isMobile ? 'none' : 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  backgroundColor: 'rgba(255, 255, 255, 0.6)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                Please complete the greetings card details first!
                {`\n`}I can't send a card without all the details!
              </Box>
            )}
          </Box>

          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            aria-labelledby="modal-modal-title"
            aria-describedby="modal-modal-description"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Card
              sx={{
                padding: '20px',
                minWidth: '300px',
                maxWidth: '600px',
              }}
            >
              <Box
                component={'p'}
                sx={{
                  whiteSpace: 'pre-wrap',
                }}
              >
                {modalMessage.title}
              </Box>
              <Box
                component={'p'}
                sx={{
                  whiteSpace: 'pre-wrap',
                }}
              >
                {modalMessage.body}
              </Box>
              {false && (
                <Accordion>
                  <AccordionSummary>behind the scenes info...</AccordionSummary>
                  <AccordionDetails
                    sx={{
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {modalMessage.accordion}
                  </AccordionDetails>
                </Accordion>
              )}
            </Card>
          </Modal>
        </Box>
      </Box>
    </>
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
