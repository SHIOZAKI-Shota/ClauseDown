use std::sync::{Arc, Mutex};

use myna_card::ap::jpki::{JpkiAp, SignatureScheme};
use myna_card::transport::pcsc::{self, PcscTransport, Sharing};
use myna_card::{Card, Pin};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use zeroize::Zeroizing;

fn err(e: impl std::fmt::Display) -> Error {
    Error::from_reason(e.to_string())
}

#[napi(object)]
pub struct Status {
    pub reader: Option<String>,
    pub card: bool,
    pub sign_cert: bool,
    pub retries: Option<u32>,
}

pub struct StatusTask;

impl Task for StatusTask {
    type Output = Status;
    type JsValue = Status;

    fn compute(&mut self) -> Result<Status> {
        let readers = pcsc::list_readers().unwrap_or_default();
        let reader = readers.first().cloned();
        let Some(name) = reader.clone() else {
            return Ok(Status { reader: None, card: false, sign_cert: false, retries: None });
        };
        let mut card = match pcsc::connect(&name, Sharing::Shared) {
            Ok(c) => c,
            Err(_) => return Ok(Status { reader, card: false, sign_cert: false, retries: None }),
        };
        let mut ap = JpkiAp::select(&mut card).map_err(err)?;
        let sign_cert = ap.read_certificate_availability().map(|a| a.has_sign_certificate()).unwrap_or(false);
        let retries = ap.sign_pin_retries().ok().and_then(|r| r.count()).map(u32::from);
        Ok(Status { reader, card: true, sign_cert, retries })
    }

    fn resolve(&mut self, _env: Env, output: Status) -> Result<Status> {
        Ok(output)
    }
}

#[napi]
pub fn status() -> AsyncTask<StatusTask> {
    AsyncTask::new(StatusTask)
}

struct Inner {
    card: Option<Card<PcscTransport>>,
    pin: Zeroizing<Vec<u8>>,
}

#[napi]
pub struct MynaSession {
    inner: Arc<Mutex<Inner>>,
    certificate: Vec<u8>,
    ca_certificate: Vec<u8>,
}

#[napi]
impl MynaSession {
    #[napi(getter)]
    pub fn certificate(&self) -> Buffer {
        self.certificate.clone().into()
    }

    #[napi(getter)]
    pub fn ca_certificate(&self) -> Buffer {
        self.ca_certificate.clone().into()
    }

    #[napi]
    pub fn sign(&self, digest: Buffer) -> AsyncTask<SignTask> {
        AsyncTask::new(SignTask { inner: self.inner.clone(), digest: digest.to_vec() })
    }

    #[napi]
    pub fn close(&self) -> AsyncTask<CloseTask> {
        AsyncTask::new(CloseTask { inner: self.inner.clone() })
    }
}

pub struct OpenTask {
    pin: Zeroizing<Vec<u8>>,
}

pub struct Opened {
    inner: Inner,
    certificate: Vec<u8>,
    ca_certificate: Vec<u8>,
}

impl Task for OpenTask {
    type Output = Opened;
    type JsValue = MynaSession;

    fn compute(&mut self) -> Result<Opened> {
        let pin = Pin::new(self.pin.as_slice()).map_err(err)?;
        let mut card = pcsc::connect_any(Sharing::Exclusive).map_err(err)?;
        let (certificate, ca_certificate) = {
            let mut ap = JpkiAp::select(&mut card).map_err(err)?;
            ap.verify_sign_pin(&pin).map_err(err)?;
            (ap.read_sign_certificate_der().map_err(err)?, ap.read_sign_ca_certificate_der().unwrap_or_default())
        };
        Ok(Opened { inner: Inner { card: Some(card), pin: self.pin.clone() }, certificate, ca_certificate })
    }

    fn resolve(&mut self, _env: Env, output: Opened) -> Result<MynaSession> {
        Ok(MynaSession { inner: Arc::new(Mutex::new(output.inner)), certificate: output.certificate, ca_certificate: output.ca_certificate })
    }
}

#[napi]
pub fn open_session(pin: String) -> AsyncTask<OpenTask> {
    AsyncTask::new(OpenTask { pin: Zeroizing::new(pin.into_bytes()) })
}

pub struct SignTask {
    inner: Arc<Mutex<Inner>>,
    digest: Vec<u8>,
}

impl Task for SignTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;

    fn compute(&mut self) -> Result<Vec<u8>> {
        if self.digest.len() != 32 {
            return Err(err("SHA-256 digest expected"));
        }
        let mut inner = self.inner.lock().map_err(err)?;
        let pin = Pin::new(inner.pin.as_slice()).map_err(err)?;
        let card = inner.card.as_mut().ok_or_else(|| err("session closed"))?;
        let mut ap = JpkiAp::select(card).map_err(err)?;
        ap.verify_sign_pin(&pin).map_err(err)?;
        ap.sign_with_sign_key(SignatureScheme::PreHashedDigestInfo, &self.digest).map_err(err)
    }

    fn resolve(&mut self, _env: Env, output: Vec<u8>) -> Result<Buffer> {
        Ok(output.into())
    }
}

pub struct CloseTask {
    inner: Arc<Mutex<Inner>>,
}

impl Task for CloseTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<()> {
        let mut inner = self.inner.lock().map_err(err)?;
        if let Some(mut card) = inner.card.take() {
            let _ = card.transport_mut().power_cycle();
        }
        inner.pin = Zeroizing::new(Vec::new());
        Ok(())
    }

    fn resolve(&mut self, _env: Env, _output: ()) -> Result<()> {
        Ok(())
    }
}
