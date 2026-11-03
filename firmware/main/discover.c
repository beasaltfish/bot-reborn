#include <stdio.h>
#include "esp_netif.h"
#include "mdns.h"
#include "body_url.h"
#include "discover.h"

#define MAX_ADDRS 8

static void collect(const mdns_result_t *list, uint32_t *addrs, size_t *n) {
  for (const mdns_result_t *r = list; r; r = r->next) {
    for (const mdns_ip_addr_t *a = r->addr; a && *n < MAX_ADDRS; a = a->next) {
      if (a->addr.type == ESP_IPADDR_TYPE_V4) addrs[(*n)++] = a->addr.u_addr.ip4.addr;
    }
  }
}

/* True when one of the candidates is on this board's own subnet. */
static bool on_my_subnet(const uint32_t *addrs, size_t n, const esp_netif_ip_info_t *mine) {
  for (size_t i = 0; i < n; i++) if ((addrs[i] & mine->netmask.addr) == (mine->ip.addr & mine->netmask.addr)) return true;
  return false;
}

/* The brain's address to dial. A computer answers with every address it has,
   virtual machines and VPNs included, and the PTR answer carries only one of
   them: when none is on this board's subnet, ask for all of the host's. */
static bool ipv4_of(const mdns_result_t *r, char *out, size_t cap, uint32_t timeout_ms) {
  uint32_t addrs[MAX_ADDRS];
  size_t n = 0;
  collect(r, addrs, &n);
  esp_netif_ip_info_t mine = {0};
  esp_netif_t *sta = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
  if (sta) esp_netif_get_ip_info(sta, &mine);
  if (!on_my_subnet(addrs, n, &mine) && r->hostname) {
    mdns_result_t *all = NULL;
    if (mdns_query(r->hostname, NULL, NULL, MDNS_TYPE_A, timeout_ms, MAX_ADDRS, &all) == ESP_OK && all) {
      collect(all, addrs, &n);
      mdns_query_results_free(all);
    }
  }
  if (n == 0) return false;
  int at = ipv4_pick(addrs, n, mine.ip.addr, mine.netmask.addr);
  printf("brain answered with %u address(es); this board is " IPSTR "/" IPSTR "; dialing #%d\n",
         (unsigned)n, IP2STR(&mine.ip), IP2STR(&mine.netmask), at);
  for (size_t i = 0; i < n; i++) {
    esp_ip4_addr_t a = { .addr = addrs[i] };
    printf("  candidate " IPSTR "\n", IP2STR(&a));
  }
  esp_ip4_addr_t pick = { .addr = addrs[at] };
  esp_ip4addr_ntoa(&pick, out, cap);
  return true;
}

bool discover_brain(char *url_out, size_t cap, uint32_t timeout_ms) {
  static bool started;
  if (!started) {
    if (mdns_init() != ESP_OK) return false;
    started = true;
  }
  mdns_result_t *found = NULL;
  if (mdns_query_ptr("_beasaltfish", "_tcp", timeout_ms, 1, &found) != ESP_OK || !found) return false;
  char host[16];
  bool ok = ipv4_of(found, host, sizeof host, timeout_ms) && body_url_build(url_out, cap, host, found->port) > 0;
  mdns_query_results_free(found);
  return ok;
}
