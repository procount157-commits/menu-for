-- Menu For You: orgs, branches, staff, menu, queue, orders, bookings,
-- customers and WhatsApp notifications. Flow Hub's own tables are untouched;
-- users gains two columns.
--
-- Safe to re-run: the tables are created once, as a block, the first time.

ALTER TABLE users ADD COLUMN IF NOT EXISTS kind varchar(10) NOT NULL DEFAULT 'owner';
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id integer;

DO $menu$
BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orgs') THEN
CREATE TABLE public.booking_settings (
    branch_id integer NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    slot_min integer DEFAULT 30 NOT NULL,
    capacity_per_slot integer DEFAULT 4 NOT NULL,
    lead_time_min integer DEFAULT 60 NOT NULL,
    max_days_ahead integer DEFAULT 14 NOT NULL,
    max_party integer DEFAULT 10 NOT NULL,
    reminder_before_min integer DEFAULT 120 NOT NULL,
    auto_confirm boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.bookings (
    id integer NOT NULL,
    org_id integer NOT NULL,
    branch_id integer NOT NULL,
    code character varying(6) NOT NULL,
    token character varying(32) NOT NULL,
    customer_name character varying(80) NOT NULL,
    phone character varying(40),
    phone_verified boolean DEFAULT false NOT NULL,
    party_size integer DEFAULT 2 NOT NULL,
    item_id integer,
    staff_id integer,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status character varying(12) DEFAULT 'confirmed'::character varying NOT NULL,
    notes text,
    reminder_sent_at timestamp with time zone,
    source character varying(12) DEFAULT 'link'::character varying NOT NULL,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.bookings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bookings_id_seq OWNED BY public.bookings.id;
CREATE TABLE public.branch_item_overrides (
    branch_id integer NOT NULL,
    item_id integer NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    price numeric(10,2),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.branches (
    id integer NOT NULL,
    org_id integer NOT NULL,
    wa_user_id integer NOT NULL,
    name character varying(160) NOT NULL,
    name_en character varying(160),
    slug character varying(60) NOT NULL,
    address text,
    map_url text,
    display_phone character varying(30),
    wa_phone character varying(20),
    hours jsonb DEFAULT '{}'::jsonb NOT NULL,
    display_token character varying(32) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.branches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.branches_id_seq OWNED BY public.branches.id;
CREATE TABLE public.customers (
    org_id integer NOT NULL,
    phone character varying(40) NOT NULL,
    name character varying(80),
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_inbound_at timestamp with time zone,
    visits integer DEFAULT 0 NOT NULL,
    orders_count integer DEFAULT 0 NOT NULL,
    bookings_count integer DEFAULT 0 NOT NULL,
    no_shows integer DEFAULT 0 NOT NULL,
    total_spent numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    favourites jsonb DEFAULT '{}'::jsonb NOT NULL,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    opt_in_at timestamp with time zone,
    last_branch_id integer,
    rating_last integer,
    review_asked_at timestamp with time zone,
    winback_at timestamp with time zone
);
CREATE TABLE public.menu_categories (
    id integer NOT NULL,
    org_id integer NOT NULL,
    name character varying(120) NOT NULL,
    name_en character varying(120),
    image_url text,
    sort integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.menu_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.menu_categories_id_seq OWNED BY public.menu_categories.id;
CREATE TABLE public.menu_items (
    id integer NOT NULL,
    org_id integer NOT NULL,
    category_id integer,
    kind character varying(10) DEFAULT 'product'::character varying NOT NULL,
    name character varying(160) NOT NULL,
    name_en character varying(160),
    description text,
    description_en text,
    price numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    compare_at_price numeric(10,2),
    duration_min integer,
    images jsonb DEFAULT '[]'::jsonb NOT NULL,
    options jsonb DEFAULT '[]'::jsonb NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    calories integer,
    allergens jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.menu_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.menu_items_id_seq OWNED BY public.menu_items.id;
CREATE TABLE public.notifications (
    id integer NOT NULL,
    org_id integer NOT NULL,
    wa_user_id integer NOT NULL,
    phone character varying(40) NOT NULL,
    kind character varying(30) NOT NULL,
    ref_type character varying(10),
    ref_id integer,
    text text NOT NULL,
    class character varying(10) NOT NULL,
    status character varying(10) DEFAULT 'queued'::character varying NOT NULL,
    reason text,
    expires_at timestamp with time zone,
    scheduled_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    wa_message_id character varying(80),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;
CREATE TABLE public.offers (
    id integer NOT NULL,
    org_id integer NOT NULL,
    branch_id integer,
    title character varying(160) NOT NULL,
    title_en character varying(160),
    body text,
    body_en text,
    image_url text,
    item_id integer,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    sort integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.offers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.offers_id_seq OWNED BY public.offers.id;
CREATE TABLE public.orders (
    id integer NOT NULL,
    org_id integer NOT NULL,
    branch_id integer NOT NULL,
    code character varying(6) NOT NULL,
    token character varying(32) NOT NULL,
    type character varying(10) DEFAULT 'pickup'::character varying NOT NULL,
    table_label character varying(20),
    customer_name character varying(80),
    phone character varying(40),
    phone_verified boolean DEFAULT false NOT NULL,
    address text,
    items jsonb NOT NULL,
    subtotal numeric(10,2) NOT NULL,
    notes text,
    scheduled_for timestamp with time zone,
    status character varying(12) DEFAULT 'pending'::character varying NOT NULL,
    ticket_id integer,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;
CREATE TABLE public.orgs (
    id integer NOT NULL,
    owner_user_id integer NOT NULL,
    name character varying(160) NOT NULL,
    name_en character varying(160),
    slug character varying(60) NOT NULL,
    vertical character varying(20) DEFAULT 'restaurant'::character varying NOT NULL,
    tagline character varying(200),
    tagline_en character varying(200),
    about text,
    logo_url text,
    cover_url text,
    theme jsonb DEFAULT '{"brand": "#c9a24a", "template": "noir"}'::jsonb NOT NULL,
    default_lang character varying(2) DEFAULT 'ar'::character varying NOT NULL,
    currency character varying(3) DEFAULT 'AED'::character varying NOT NULL,
    timezone character varying(40) DEFAULT 'Asia/Dubai'::character varying NOT NULL,
    socials jsonb DEFAULT '{}'::jsonb NOT NULL,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    onboarded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.orgs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.orgs_id_seq OWNED BY public.orgs.id;
CREATE TABLE public.queue_counters (
    queue_id integer NOT NULL,
    service_day date NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.queue_events (
    id integer NOT NULL,
    queue_id integer NOT NULL,
    ticket_id integer,
    type character varying(16) NOT NULL,
    staff_id integer,
    detail text,
    at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.queue_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.queue_events_id_seq OWNED BY public.queue_events.id;
CREATE TABLE public.queue_tickets (
    id integer NOT NULL,
    org_id integer NOT NULL,
    branch_id integer NOT NULL,
    queue_id integer NOT NULL,
    service_day date NOT NULL,
    number integer NOT NULL,
    display_code character varying(10) NOT NULL,
    token character varying(32) NOT NULL,
    join_code character varying(6) NOT NULL,
    customer_name character varying(80),
    party_size integer DEFAULT 1 NOT NULL,
    service_item_id integer,
    phone character varying(40),
    phone_verified boolean DEFAULT false NOT NULL,
    status character varying(12) DEFAULT 'waiting'::character varying NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    source character varying(12) DEFAULT 'link'::character varying NOT NULL,
    note text,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    called_at timestamp with time zone,
    serving_at timestamp with time zone,
    finished_at timestamp with time zone,
    called_by integer,
    recall_count integer DEFAULT 0 NOT NULL,
    on_my_way_at timestamp with time zone,
    ahead_notified_at timestamp with time zone,
    eta_at_join_min integer,
    booking_id integer,
    device_id character varying(40),
    marketing_opt_in boolean DEFAULT false NOT NULL
);
CREATE SEQUENCE public.queue_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.queue_tickets_id_seq OWNED BY public.queue_tickets.id;
CREATE TABLE public.queues (
    id integer NOT NULL,
    org_id integer NOT NULL,
    branch_id integer NOT NULL,
    name character varying(80) NOT NULL,
    name_en character varying(80),
    prefix character varying(3) DEFAULT 'A'::character varying NOT NULL,
    is_open boolean DEFAULT true NOT NULL,
    is_paused boolean DEFAULT false NOT NULL,
    avg_service_min integer DEFAULT 5 NOT NULL,
    eta_adjust_min integer DEFAULT 0 NOT NULL,
    max_waiting integer DEFAULT 150 NOT NULL,
    notify_ahead integer DEFAULT 2 NOT NULL,
    no_show_min integer DEFAULT 5 NOT NULL,
    auto_no_show boolean DEFAULT false NOT NULL,
    remote_join character varying(10) DEFAULT 'anyone'::character varying NOT NULL,
    ask_party_size boolean DEFAULT true NOT NULL,
    ask_service boolean DEFAULT false NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.queues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.queues_id_seq OWNED BY public.queues.id;
CREATE TABLE public.staff (
    id integer NOT NULL,
    org_id integer NOT NULL,
    branch_id integer,
    name character varying(120) NOT NULL,
    username character varying(40) NOT NULL,
    password_hash text NOT NULL,
    role character varying(20) DEFAULT 'staff'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.staff_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.staff_id_seq OWNED BY public.staff.id;
CREATE TABLE public.wa_templates (
    id integer NOT NULL,
    org_id integer NOT NULL,
    key character varying(30) NOT NULL,
    text_ar text NOT NULL,
    text_en text,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.wa_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.wa_templates_id_seq OWNED BY public.wa_templates.id;
ALTER TABLE ONLY public.bookings ALTER COLUMN id SET DEFAULT nextval('public.bookings_id_seq'::regclass);
ALTER TABLE ONLY public.branches ALTER COLUMN id SET DEFAULT nextval('public.branches_id_seq'::regclass);
ALTER TABLE ONLY public.menu_categories ALTER COLUMN id SET DEFAULT nextval('public.menu_categories_id_seq'::regclass);
ALTER TABLE ONLY public.menu_items ALTER COLUMN id SET DEFAULT nextval('public.menu_items_id_seq'::regclass);
ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);
ALTER TABLE ONLY public.offers ALTER COLUMN id SET DEFAULT nextval('public.offers_id_seq'::regclass);
ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);
ALTER TABLE ONLY public.orgs ALTER COLUMN id SET DEFAULT nextval('public.orgs_id_seq'::regclass);
ALTER TABLE ONLY public.queue_events ALTER COLUMN id SET DEFAULT nextval('public.queue_events_id_seq'::regclass);
ALTER TABLE ONLY public.queue_tickets ALTER COLUMN id SET DEFAULT nextval('public.queue_tickets_id_seq'::regclass);
ALTER TABLE ONLY public.queues ALTER COLUMN id SET DEFAULT nextval('public.queues_id_seq'::regclass);
ALTER TABLE ONLY public.staff ALTER COLUMN id SET DEFAULT nextval('public.staff_id_seq'::regclass);
ALTER TABLE ONLY public.wa_templates ALTER COLUMN id SET DEFAULT nextval('public.wa_templates_id_seq'::regclass);
ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_pkey PRIMARY KEY (branch_id);
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_token_unique UNIQUE (token);
ALTER TABLE ONLY public.branch_item_overrides
    ADD CONSTRAINT branch_item_overrides_branch_id_item_id_pk PRIMARY KEY (branch_id, item_id);
ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_org_id_phone_pk PRIMARY KEY (org_id, phone);
ALTER TABLE ONLY public.menu_categories
    ADD CONSTRAINT menu_categories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_token_unique UNIQUE (token);
ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_owner_user_id_unique UNIQUE (owner_user_id);
ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_slug_unique UNIQUE (slug);
ALTER TABLE ONLY public.queue_counters
    ADD CONSTRAINT queue_counters_queue_id_service_day_pk PRIMARY KEY (queue_id, service_day);
ALTER TABLE ONLY public.queue_events
    ADD CONSTRAINT queue_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.queue_tickets
    ADD CONSTRAINT queue_tickets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.queue_tickets
    ADD CONSTRAINT queue_tickets_token_unique UNIQUE (token);
ALTER TABLE ONLY public.queues
    ADD CONSTRAINT queues_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.wa_templates
    ADD CONSTRAINT wa_templates_pkey PRIMARY KEY (id);
CREATE INDEX idx_bookings_branch ON public.bookings USING btree (branch_id, starts_at);
CREATE INDEX idx_bookings_code ON public.bookings USING btree (code);
CREATE INDEX idx_branch_wa_user ON public.branches USING btree (wa_user_id);
CREATE INDEX idx_customers_seen ON public.customers USING btree (org_id, last_seen_at);
CREATE INDEX idx_menu_cat_org ON public.menu_categories USING btree (org_id, sort);
CREATE INDEX idx_menu_item_org ON public.menu_items USING btree (org_id, category_id, sort);
CREATE INDEX idx_notifications_due ON public.notifications USING btree (status, scheduled_at);
CREATE INDEX idx_notifications_org ON public.notifications USING btree (org_id, created_at);
CREATE INDEX idx_offer_org ON public.offers USING btree (org_id);
CREATE INDEX idx_orders_branch ON public.orders USING btree (branch_id, created_at);
CREATE INDEX idx_orders_code ON public.orders USING btree (code);
CREATE INDEX idx_queue_branch ON public.queues USING btree (branch_id);
CREATE INDEX idx_queue_events ON public.queue_events USING btree (queue_id, at);
CREATE INDEX idx_ticket_join_code ON public.queue_tickets USING btree (join_code);
CREATE INDEX idx_ticket_phone ON public.queue_tickets USING btree (org_id, phone);
CREATE INDEX idx_ticket_queue_status ON public.queue_tickets USING btree (queue_id, service_day, status);
CREATE UNIQUE INDEX uq_branch_slug ON public.branches USING btree (org_id, slug);
CREATE UNIQUE INDEX uq_staff_username ON public.staff USING btree (org_id, username);
CREATE UNIQUE INDEX uq_ticket_number ON public.queue_tickets USING btree (queue_id, service_day, number);
CREATE UNIQUE INDEX uq_wa_template ON public.wa_templates USING btree (org_id, key);
ALTER TABLE ONLY public.booking_settings
    ADD CONSTRAINT booking_settings_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_item_id_menu_items_id_fk FOREIGN KEY (item_id) REFERENCES public.menu_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.branch_item_overrides
    ADD CONSTRAINT branch_item_overrides_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.branch_item_overrides
    ADD CONSTRAINT branch_item_overrides_item_id_menu_items_id_fk FOREIGN KEY (item_id) REFERENCES public.menu_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_wa_user_id_users_id_fk FOREIGN KEY (wa_user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.menu_categories
    ADD CONSTRAINT menu_categories_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_category_id_menu_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.menu_categories(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_item_id_menu_items_id_fk FOREIGN KEY (item_id) REFERENCES public.menu_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.queue_counters
    ADD CONSTRAINT queue_counters_queue_id_queues_id_fk FOREIGN KEY (queue_id) REFERENCES public.queues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.queue_events
    ADD CONSTRAINT queue_events_queue_id_queues_id_fk FOREIGN KEY (queue_id) REFERENCES public.queues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.queue_events
    ADD CONSTRAINT queue_events_ticket_id_queue_tickets_id_fk FOREIGN KEY (ticket_id) REFERENCES public.queue_tickets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.queue_tickets
    ADD CONSTRAINT queue_tickets_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.queue_tickets
    ADD CONSTRAINT queue_tickets_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.queue_tickets
    ADD CONSTRAINT queue_tickets_queue_id_queues_id_fk FOREIGN KEY (queue_id) REFERENCES public.queues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.queue_tickets
    ADD CONSTRAINT queue_tickets_service_item_id_menu_items_id_fk FOREIGN KEY (service_item_id) REFERENCES public.menu_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.queues
    ADD CONSTRAINT queues_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.queues
    ADD CONSTRAINT queues_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_branch_id_branches_id_fk FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.wa_templates
    ADD CONSTRAINT wa_templates_org_id_orgs_id_fk FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;
END IF;
END
$menu$;
