# Mahar POS manuals

Burmese visual manuals, served from `/var/www/maharshwe.shop/manual/` (the
maharpos.shop webroot).

    https://maharpos.shop/manual/products-sale/
    https://maharpos.shop/manual/registration/

The originals arrived with every screenshot base64-inlined, which made the
HTML 99% image data — the browser had to download 700 KB before it could
paint a single line of Burmese. `scratchpad/split_manual.py` extracts the
images to `img/`, points the tags at them and marks all but the first
`loading="lazy"`.

    html 706 KB -> 9 KB   (products-sale, 9 images)
    html 224 KB -> 7 KB   (registration, 3 images)

## Deploy

    tar czf manual.tgz -C public-sites manual
    scp manual.tgz root@157.245.61.106:/tmp/
    ssh root@157.245.61.106 'cd /var/www/maharshwe.shop && tar xzf /tmp/manual.tgz \
        && chown -R www-data:www-data manual && rm /tmp/manual.tgz'
