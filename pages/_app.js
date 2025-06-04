// pages/_app.js
import Head from 'next/head'
import '../styles/globals.css'     // keep this if you already have a global CSS file

function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        {/* 
          If you used "favicon.png" instead of .ico, change this line to:
            <link rel="icon" href="/favicon.png" type="image/png" />
          Otherwise leave it as /favicon.ico
        */}
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}

export default MyApp
