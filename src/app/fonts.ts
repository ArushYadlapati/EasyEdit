import {
  Anton,
  Archivo_Black,
  Audiowide,
  Bangers,
  Barlow,
  Barlow_Condensed,
  Bebas_Neue,
  Caveat,
  DM_Sans,
  DM_Serif_Display,
  Exo_2,
  Fira_Sans,
  IBM_Plex_Sans,
  Inter,
  JetBrains_Mono,
  Kanit,
  Lato,
  Lobster,
  Lora,
  Merriweather,
  Montserrat,
  Nunito,
  Open_Sans,
  Orbitron,
  Oswald,
  Pacifico,
  Permanent_Marker,
  Playfair_Display,
  Poppins,
  Rajdhani,
  Raleway,
  Righteous,
  Roboto,
  Rubik,
  Russo_One,
  Source_Serif_4,
  Space_Grotesk,
  Teko,
  Titillium_Web,
  Work_Sans,
  Geist,
  Geist_Mono,
} from "next/font/google";

// Every font text can be set in (src/lib/brand/fonts.ts), served from this app: next/font downloads the files when the
// app is built. Each sets its own CSS variable on <html>, which FONT_VARS (src/lib/editor/fonts.ts) reads, so the preview,
// thumbnails and export draw it as they draw Geist. Nothing is preloaded: a browser only fetches a font text uses.
// Variable fonts load their one variable file; the others load the weights the list gives them.

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const antonFont = Anton({ variable: "--font-anton", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const archivoBlackFont = Archivo_Black({ variable: "--font-archivo-black", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const audiowideFont = Audiowide({ variable: "--font-audiowide", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const bangersFont = Bangers({ variable: "--font-bangers", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const barlowFont = Barlow({ variable: "--font-barlow", subsets: ["latin"], display: "swap", preload: false, weight: ["300", "400", "500", "600", "700", "800", "900"], });
const barlowCondensedFont = Barlow_Condensed({ variable: "--font-barlow-condensed", subsets: ["latin"], display: "swap", preload: false, weight: ["300", "400", "500", "600", "700", "800", "900"], });
const bebasNeueFont = Bebas_Neue({ variable: "--font-bebas-neue", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const caveatFont = Caveat({ variable: "--font-caveat", subsets: ["latin"], display: "swap", preload: false, });
const dMSansFont = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], display: "swap", preload: false, });
const dMSerifDisplayFont = DM_Serif_Display({ variable: "--font-dm-serif-display", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const exo2Font = Exo_2({ variable: "--font-exo-2", subsets: ["latin"], display: "swap", preload: false, });
const firaSansFont = Fira_Sans({ variable: "--font-fira-sans", subsets: ["latin"], display: "swap", preload: false, weight: ["300", "400", "500", "600", "700", "800", "900"], });
const iBMPlexSansFont = IBM_Plex_Sans({ variable: "--font-ibm-plex-sans", subsets: ["latin"], display: "swap", preload: false, });
const interFont = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap", preload: false, });
const jetBrainsMonoFont = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], display: "swap", preload: false, });
const kanitFont = Kanit({ variable: "--font-kanit", subsets: ["latin"], display: "swap", preload: false, weight: ["300", "400", "500", "600", "700", "800", "900"], });
const latoFont = Lato({ variable: "--font-lato", subsets: ["latin"], display: "swap", preload: false, weight: ["300", "400", "700", "900"], });
const lobsterFont = Lobster({ variable: "--font-lobster", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const loraFont = Lora({ variable: "--font-lora", subsets: ["latin"], display: "swap", preload: false, });
const merriweatherFont = Merriweather({ variable: "--font-merriweather", subsets: ["latin"], display: "swap", preload: false, });
const montserratFont = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], display: "swap", preload: false, });
const nunitoFont = Nunito({ variable: "--font-nunito", subsets: ["latin"], display: "swap", preload: false, });
const openSansFont = Open_Sans({ variable: "--font-open-sans", subsets: ["latin"], display: "swap", preload: false, });
const orbitronFont = Orbitron({ variable: "--font-orbitron", subsets: ["latin"], display: "swap", preload: false, });
const oswaldFont = Oswald({ variable: "--font-oswald", subsets: ["latin"], display: "swap", preload: false, });
const pacificoFont = Pacifico({ variable: "--font-pacifico", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const permanentMarkerFont = Permanent_Marker({ variable: "--font-permanent-marker", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const playfairDisplayFont = Playfair_Display({ variable: "--font-playfair-display", subsets: ["latin"], display: "swap", preload: false, });
const poppinsFont = Poppins({ variable: "--font-poppins", subsets: ["latin"], display: "swap", preload: false, weight: ["300", "400", "500", "600", "700", "800", "900"], });
const rajdhaniFont = Rajdhani({ variable: "--font-rajdhani", subsets: ["latin"], display: "swap", preload: false, weight: ["300", "400", "500", "600", "700"], });
const ralewayFont = Raleway({ variable: "--font-raleway", subsets: ["latin"], display: "swap", preload: false, });
const righteousFont = Righteous({ variable: "--font-righteous", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const robotoFont = Roboto({ variable: "--font-roboto", subsets: ["latin"], display: "swap", preload: false, });
const rubikFont = Rubik({ variable: "--font-rubik", subsets: ["latin"], display: "swap", preload: false, });
const russoOneFont = Russo_One({ variable: "--font-russo-one", subsets: ["latin"], display: "swap", preload: false, weight: ["400"], });
const sourceSerif4Font = Source_Serif_4({ variable: "--font-source-serif-4", subsets: ["latin"], display: "swap", preload: false, });
const spaceGroteskFont = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"], display: "swap", preload: false, });
const tekoFont = Teko({ variable: "--font-teko", subsets: ["latin"], display: "swap", preload: false, });
const titilliumWebFont = Titillium_Web({ variable: "--font-titillium-web", subsets: ["latin"], display: "swap", preload: false, weight: ["300", "400", "600", "700", "900"], });
const workSansFont = Work_Sans({ variable: "--font-work-sans", subsets: ["latin"], display: "swap", preload: false, });

// The class names that set every font variable, for <html>.
export const FONT_VARIABLE_CLASSES = [
  geistSans.variable,
  geistMono.variable,
  antonFont.variable,
  archivoBlackFont.variable,
  audiowideFont.variable,
  bangersFont.variable,
  barlowFont.variable,
  barlowCondensedFont.variable,
  bebasNeueFont.variable,
  caveatFont.variable,
  dMSansFont.variable,
  dMSerifDisplayFont.variable,
  exo2Font.variable,
  firaSansFont.variable,
  iBMPlexSansFont.variable,
  interFont.variable,
  jetBrainsMonoFont.variable,
  kanitFont.variable,
  latoFont.variable,
  lobsterFont.variable,
  loraFont.variable,
  merriweatherFont.variable,
  montserratFont.variable,
  nunitoFont.variable,
  openSansFont.variable,
  orbitronFont.variable,
  oswaldFont.variable,
  pacificoFont.variable,
  permanentMarkerFont.variable,
  playfairDisplayFont.variable,
  poppinsFont.variable,
  rajdhaniFont.variable,
  ralewayFont.variable,
  righteousFont.variable,
  robotoFont.variable,
  rubikFont.variable,
  russoOneFont.variable,
  sourceSerif4Font.variable,
  spaceGroteskFont.variable,
  tekoFont.variable,
  titilliumWebFont.variable,
  workSansFont.variable,
].join(" ");
