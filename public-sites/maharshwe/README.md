# maharshwe.shop — Mahar Shwe company site

Served from `/var/www/maharshwe-brand` on the VPS (nginx: `maharshwe-brand.conf`).
The POS product and the multi-tenant storefronts live on maharpos.shop; this
host 301s `/shop/<slug>` across so saved customer links keep working.

## Deploy

    scp public-sites/maharshwe/index.html root@157.245.61.106:/var/www/maharshwe-brand/index.html
    scp public-sites/maharshwe/assets/*   root@157.245.61.106:/var/www/maharshwe-brand/assets/

## VPN APKs

`/var/www/maharshwe-brand/download/` holds the release APKs. They are not in
git — a 50 MB binary does not belong in the repo. To publish a new build, copy
the three variants up and bump the version and sizes in `index.html`:

    scp maharshwe-vpn-<ver>-{mid-arm64,low-armv7,high-universal}.apk \
        root@157.245.61.106:/var/www/maharshwe-brand/download/

Current: 1.0.23 (arm64 21.4 MB · armv7 21.0 MB · universal 49.4 MB)
