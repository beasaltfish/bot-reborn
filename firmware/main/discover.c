#include <stdio.h>
#include "esp_netif.h"
#include "mdns.h"
#include "body_url.h"
#include "discover.h"

/* The brain's address to dial. A computer answers with every address it has,
   virtual machines and VPNs included; prefer the one on this board's subnet. */
static bool ipv4_of(const mdns_result_t *r, char *out, size_t cap, uint32_t timeout_ms) {
  uint32_t addrs[8];
  size_t n = 0;
  for (const mdns_ip_addr_t *a = r->addr; a && n < 8; a = a->next) {
    if (a->addr.type == ESP_IPADDR_TYPE_V4) addrs[n++] = a->addr.u_addr.ip4.addr;
  }
  if (n == 0) {   /* without the A records in the answer, ask for the host's address */
    esp_ip4_addr_t ip;
    if (!r->hostname || mdns_query_a(r->hostname, timeout_ms, &ip) != ESP_OK) return false;
    addrs[n++] = ip.addr;
  }
  esp_netif_ip_info_t mine = {0};
  esp_netif_t *sta = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
  if (sta) esp_netif_get_ip_info(sta, &mine);
  esp_ip4_addr_t pick = { .addr = addrs[ipv4_pick(addrs, n, mine.ip.addr, mine.netmask.addr)] };
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
