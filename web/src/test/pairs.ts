// Throwaway certificate/key pairs for tests that need a key that belongs to its certificate (the live
// SSL test presents them through the gateway). Generated once with OpenSSL 3.6, self-signed, valid ten
// years from 2026-11-15; they protect nothing. The parseCert fixtures are in certs.ts.

/** EC P-256, CN and SAN rotated.apiseven.test. */
export const EC_PAIR = {
  cert: `-----BEGIN CERTIFICATE-----
MIIBuDCCAV2gAwIBAgIUXeNe1Ky+hopn8WOYku8A8FY3mX8wCgYIKoZIzj0EAwIw
IDEeMBwGA1UEAwwVcm90YXRlZC5hcGlzZXZlbi50ZXN0MB4XDTI2MTExNTA1NDAx
MloXDTM2MTExMjA1NDAxMlowIDEeMBwGA1UEAwwVcm90YXRlZC5hcGlzZXZlbi50
ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEJkR1XQnXPIDp3Eg9DBCk4LcI
44DAukL39uZWhVTDpFYYrKN7mVQKH/sxMT/nq1kj79cv99b+0BLUmN5yt9qlJ6N1
MHMwHQYDVR0OBBYEFFnGGpmzEm5fgD3Lp/RQ1qEoOZfvMB8GA1UdIwQYMBaAFFnG
GpmzEm5fgD3Lp/RQ1qEoOZfvMA8GA1UdEwEB/wQFMAMBAf8wIAYDVR0RBBkwF4IV
cm90YXRlZC5hcGlzZXZlbi50ZXN0MAoGCCqGSM49BAMCA0kAMEYCIQDGsUNu0rYZ
GJKDfaAhgAUgX78DFing6Cj7IXZjNmf4cwIhAK6UNfFXjF3/guSViSo8gVD3QdtX
50ORFGIsx1ESwHHe
-----END CERTIFICATE-----
`,
  key: `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgOBcdPqb8thJlCRca
zixHZNYLJT4gEeyDJVEo1PPUnTehRANCAAQmRHVdCdc8gOncSD0MEKTgtwjjgMC6
Qvf25laFVMOkVhiso3uZVAof+zExP+erWSPv1y/31v7QEtSY3nK32qUn
-----END PRIVATE KEY-----
`,
};

/** RSA-2048, CN and SAN rsa-extra.apiseven.test. */
export const RSA_PAIR = {
  cert: `-----BEGIN CERTIFICATE-----
MIIDSTCCAjGgAwIBAgIUDynKXFSdbkxwK1g+B8KX5Zd5Vv4wDQYJKoZIhvcNAQEL
BQAwIjEgMB4GA1UEAwwXcnNhLWV4dHJhLmFwaXNldmVuLnRlc3QwHhcNMjYxMTE1
MDU0MDEyWhcNMzYxMTEyMDU0MDEyWjAiMSAwHgYDVQQDDBdyc2EtZXh0cmEuYXBp
c2V2ZW4udGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALi2umNe
3wc5UXCQohP0+u0mJbeOlHo3ncs4LqTzOt7i2J6gn3pnccHl5R8wW8OYICe9Dp7w
ia1WxvTZL0DFiOos2cweg2K5seJVy0Ng2GWAAptVyF0p9hyMntCpsJkYZopC5hvE
ap7icnpbYKBtd5B8BLK/lVRiWGZ2TGyB3yWgpnbF1rKnR7t9vn3u2ccoriP/oE5T
hbgD+vm2Ez8kpKitmtbf2PNlWntLSWkehA0r/3/jFsJ+gmrPy7xiyPfrmymgsyR+
0ZUJl10J/kOxKCz5GYy33wihsXI9kZNcwUdsvmpoUEfFwiqv3EftEm3wURgOMXRU
6JGCUT/TwSOI3GECAwEAAaN3MHUwHQYDVR0OBBYEFCkDZtOCmLeBvVZWGqSgNKBq
7sJzMB8GA1UdIwQYMBaAFCkDZtOCmLeBvVZWGqSgNKBq7sJzMA8GA1UdEwEB/wQF
MAMBAf8wIgYDVR0RBBswGYIXcnNhLWV4dHJhLmFwaXNldmVuLnRlc3QwDQYJKoZI
hvcNAQELBQADggEBAAInKowD4vBG/HnILA+AV1zEK6Lz1wyTRFHt0TvoA3n3ds0T
QVz0XapawV0OWIv0tQ9d5m4FS7lb//oBV5bX08hR6zKGxG0YLxBrv3ThSJ8OVWYT
RtQCFk0SJA9MwKjO6Jbw1pxIG+x3mMpZG+ccoQZpJo9T2NiPWSAIsmxaZcakCNNN
a9b4/zfUWKaCyDfNgsT9KjsZFvOYbQcawYNL+7y/4Dq4djlcc2Nh+L66ptI/ajMP
WtB1qwi4RQdngtCY8mZ4Z0GqWX0X9tx5A0WFc8dio7yWTN4TQEHsCFQ612gow2sr
p1YtQnTAXm4vbjAq4U251KZ6ABYQFW0+E9s4S1U=
-----END CERTIFICATE-----
`,
  key: `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQC4trpjXt8HOVFw
kKIT9PrtJiW3jpR6N53LOC6k8zre4tieoJ96Z3HB5eUfMFvDmCAnvQ6e8ImtVsb0
2S9AxYjqLNnMHoNiubHiVctDYNhlgAKbVchdKfYcjJ7QqbCZGGaKQuYbxGqe4nJ6
W2CgbXeQfASyv5VUYlhmdkxsgd8loKZ2xdayp0e7fb597tnHKK4j/6BOU4W4A/r5
thM/JKSorZrW39jzZVp7S0lpHoQNK/9/4xbCfoJqz8u8Ysj365spoLMkftGVCZdd
Cf5DsSgs+RmMt98IobFyPZGTXMFHbL5qaFBHxcIqr9xH7RJt8FEYDjF0VOiRglE/
08EjiNxhAgMBAAECggEACVq/r76jPuNpO3EntCkI+C+hY11mKZZdeGg8/H+Q8K6+
V7I8wV8xxKcW5nB1hT9UCY8qiWQXJN8rLkU9fmNCntFsqki1UK+k0ZiUtbHW47UK
7MD4Z7dzTljUxi6B0g8JSmE+9BMLb0Z6k7XC+/zvPDL7re3D60UbwvykvC4LlgUp
nDhW0Z7MhA3CXU34/b/txMymTS7eARGgdzEiCa6EqnT47kG9lPWGiRmwq/Ldbsau
HI5EfQ+ytWooWE/iV/YBGYKLs98NWmXh9xLCPiqu6F65xHHp7jRwVZnwaNM7uxwr
Ys9roRQbukTXXzFMxdhOniesssZTMpWxSRbqAdG9UQKBgQD0TahH+QSJJbuJrYH3
EgKtfvQr1tcmebyqVqyn0mJf6T8XTwyan12wMhNclQJIqDEsVhBomYJyvgXBlqCS
79SGzPe+gBMPOK5p7MzMjPcK7PwYZkXRlXbDVJZJ+uwKwMsIdslZ6ai4FP7ufo+I
K0YV2cAOI4EC7wwUClZ4tKrJ9QKBgQDBjrOnGhRtEXTjW7L5ttn84t9ALzNQXJ6p
+CTcXCH2TonxWS+VH+FyZPfsZMSUvZhp3EbCkxp4BoDv9rDOTSxc+vYl5bF4DFo5
UfKVX6ar3L+FG/ruqknRfzQyycFFz1/hEd8aHkTG83pY63ufxNtn3fH6F7+dD4jW
fIMjMvSpPQKBgQCsxa7ZF5bJl1HF0Fs1bBtQr5Pm3Q1TPIzcumdoWDUSN1ZTGaiE
QWh0jzV6KDdxQuFjxYndL5M9qn1Pp0LwJ4RZwOMEancQMLnIV5uOnbKom2i9qLZ/
vgA7q7qNn1MHV8k+tyM23zRe2xpfeEnxtwjdsx1L4nf+pygXlCgLPVn7cQKBgQCL
qeWWCOp+PN9kAtHk//zRTf8beDOFpB9Us9odK1nSOZ+th9Yeu49YlOSULa3vSdNF
Z42jbrPlsYOuIwo3AlaljOy6McBZyEf+HlR1VjyUvEdxy9vIBRYY1bmbgBs2vUkI
xXV/iiHEkQFSUjC0+z3595tYA3Te5sutQND7QBRsXQKBgQDOf27ixYZE6QND64gj
xQyKVMeyEyTNNE5H6G7T3EZlUE8mY2V3FQXW7EOncLegKYOUltQ5WJD860GOm9Z4
YJqdbBmXoq7+g6RtOGxrQ7mDRp4l0oftZHJymgxgdppqMiwXH8kmN9XiQCW40NQi
jgl1psnV7foT8KubnGCNgfG9Lg==
-----END PRIVATE KEY-----
`,
};

/**
 * EC_PAIR's key as `openssl ecparam -genkey` writes one: an EC PARAMETERS block, then the SEC1 key
 * (`openssl pkey -traditional`). OpenSSL skips the parameters when it reads the key; APISIX stores and
 * serves it (the gated live test).
 */
export const EC_PARAMS_KEY = `-----BEGIN EC PARAMETERS-----
BggqhkjOPQMBBw==
-----END EC PARAMETERS-----
-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIDgXHT6m/LYSZQkXGs4sR2TWCyU+IBHsgyVRKNTz1J03oAoGCCqGSM49
AwEHoUQDQgAEJkR1XQnXPIDp3Eg9DBCk4LcI44DAukL39uZWhVTDpFYYrKN7mVQK
H/sxMT/nq1kj79cv99b+0BLUmN5yt9qlJw==
-----END EC PRIVATE KEY-----
`;

/**
 * RSA_PAIR's key as a PKCS#12 export prints it (`openssl pkcs12 -nodes -nocerts`): Bag Attributes
 * lines before the key. APISIX refuses it: the text does not start with "---", so it is taken for an
 * encrypted key ("failed to decrypt previous encrypted key", the gated live test).
 */
export const BAG_KEY = `Bag Attributes
    friendlyName: rsa-extra
    localKeyID: 5D 10 50 76 B3 03 DC 30 63 E8 43 99 8D AB 0F 04 80 BE A1 81
Key Attributes: <No Attributes>
${RSA_PAIR.key}`;
